export type PageRequest = { page:number; pageSize:number; q:string };
export function paginationInput(params:URLSearchParams, strict=true):PageRequest {
  const number=(key:string,fallback:number,max:number)=>{
    const raw=params.get(key);if(raw===null)return fallback;
    const value=Number(raw);
    if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(value)||value>max){if(strict)throw new Error(`Invalid ${key}`);return fallback;}
    return value;
  };
  return {page:number('page',1,1000000),pageSize:number('pageSize',25,100),q:(params.get('q')??'').trim().slice(0,200)};
}
export function paginationBounds(input:PageRequest,total:number) {
  const pages=Math.max(1,Math.ceil(total/input.pageSize)),page=Math.min(input.page,pages);
  return {page,pageSize:input.pageSize,pages,total,skip:(page-1)*input.pageSize};
}
export function pageHref(path:string,query:string,page:number,key="page") {
  const params=new URLSearchParams(query);params.set(key,String(page));return path+'?'+params.toString();
}
