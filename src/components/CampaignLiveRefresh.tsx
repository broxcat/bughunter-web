'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Activity = { id: string; active: boolean; key: string };

/** One status stream for the page, mounted only during persisted active work. */
export default function CampaignLiveRefresh({ activity }: { activity: Activity[] }) {
  const router = useRouter();
  const ids = activity.map(row => row.id).join(',');
  const initial = JSON.stringify(activity);
  const last = useRef(initial);
  useEffect(() => { last.current = initial; }, [initial]);
  useEffect(() => {
    if (!ids) return;
    const stream = new EventSource('/api/programs/campaign-stream?ids=' + encodeURIComponent(ids));
    stream.onmessage = event => {
      let rows: (Activity | null)[];
      try { rows = JSON.parse(event.data); } catch { return; }
      if (!rows.some(row => row?.active)) stream.close();
      if (last.current === event.data) return;
      last.current = event.data;
      router.refresh();
    };
    return () => stream.close();
  }, [ids, router]);
  return null;
}
