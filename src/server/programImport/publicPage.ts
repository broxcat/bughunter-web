import { parseDocument } from 'htmlparser2';
import { MAX_PROGRAM_SOURCE } from '@/lib/programIntake';
import { rateLimit } from '@/lib/rateLimit';
import { detectProgram } from './preview';

export const PUBLIC_PAGE_UNAVAILABLE = 'This public program page is unavailable. Paste the program Markdown to continue.';
const hosts = { HACKERONE: 'hackerone.com', BUGCROWD: 'bugcrowd.com', INTIGRITI: 'app.intigriti.com', YESWEHACK: 'yeswehack.com' };
type ChildNode = ReturnType<typeof parseDocument>['children'][number];
const hidden = new Set(['script', 'style', 'nav', 'footer', 'aside', 'noscript', 'svg', 'template', 'form', 'head']);
const block = new Set(['div', 'article', 'section', 'header', 'main', 'body', 'p', 'ul', 'ol', 'table', 'tbody', 'thead', 'blockquote']);

export function htmlProgramText(html: string) {
  const document = parseDocument(html);
  const render = (node: ChildNode, inline = false): string => {
    if (node.type === 'text') return node.data.replace(/\s+/g, ' ');
    if (node.type !== 'tag' || hidden.has(node.name) || 'hidden' in node.attribs || node.attribs['aria-hidden'] === 'true') return '';
    if (node.name === 'br') return '\n';
    if (node.name === 'tr') return '\n| ' + node.children.filter(child => child.type === 'tag' && ['td', 'th'].includes(child.name))
      .map(cell => render(cell, true).trim()).join(' | ') + ' |\n';
    const contents = node.children.map(child => render(child, inline || /^(?:td|th|h[1-6])$/.test(node.name))).join('');
    if (/^h[1-6]$/.test(node.name)) return '\n' + '#'.repeat(Number(node.name[1])) + ' ' + contents.trim() + '\n';
    if (node.name === 'li') return '\n- ' + contents.trim() + '\n';
    return !inline && block.has(node.name) ? '\n' + contents + '\n' : contents;
  };
  return document.children.map(node => render(node)).join('').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}

async function readBounded(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(PUBLIC_PAGE_UNAVAILABLE);
  try {
    const decoder = new TextDecoder();
    let size = 0, html = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return html + decoder.decode();
      size += chunk.value.length;
      if (size > 1024 * 1024) throw new Error(PUBLIC_PAGE_UNAVAILABLE);
      html += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const cache = new Map<string, { text: string; expiresAt: number }>();
export async function publicProgramText(input: string, request = fetch, admit = rateLimit) {
  const detected = detectProgram(input);
  if (!detected) throw new Error('This URL does not match a supported program. Paste the program Markdown to continue.');
  const { reference } = detected;
  const url = new URL(reference.url);
  if (url.protocol !== 'https:' || url.host !== hosts[reference.platform] || url.username || url.password || url.search || url.hash) {
    throw new Error(PUBLIC_PAGE_UNAVAILABLE);
  }
  const cached = cache.get(url.href);
  if (cached && cached.expiresAt > Date.now()) return { reference, text: cached.text };
  if ((await admit('rl:public-program:' + reference.platform, 20, 60)).status !== 'ALLOWED') {
    throw new Error('Public program downloads are temporarily unavailable. Paste the program Markdown to continue.');
  }
  try {
    const response = await request(url, { redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok || !/^text\/html\b/i.test(response.headers.get('Content-Type') ?? '')) {
      await response.body?.cancel().catch(() => {});
      throw new Error(PUBLIC_PAGE_UNAVAILABLE);
    }
    const text = htmlProgramText(await readBounded(response));
    if (!text || text.length > MAX_PROGRAM_SOURCE) throw new Error(PUBLIC_PAGE_UNAVAILABLE);
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(url.href, { text, expiresAt: Date.now() + 120_000 });
    return { reference, text };
  } catch {
    throw new Error(PUBLIC_PAGE_UNAVAILABLE);
  }
}
