import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ShareMultiFile, ShareSelectResponse } from '@/lib/api/share';
import { parseTable, sniffDelimiter } from '@/lib/csv';
import { renderMarkdown } from '@/lib/markdown';
import {
  bareMime,
  downloadHref,
  fetchTextPreview,
  isMarkdownName,
  previewKind,
  tableFlavor,
  triggerDownload,
  triggerTextDownload,
} from '@/lib/preview';
import { haptic, reducedMotion } from '../haptics';
import { Icon } from './IconSprite';

/** Length of the close animation (`ydFadeOut` / `ydPopOut` / `ydSheetOut`). */
const EXIT_MS=180;
/** Table preview caps; the note under the table names them when hit. */
const TABLE_MAX_ROWS=500;
const TABLE_MAX_COLS=50;

/** `auto` = Markdown heuristic (pasted text, notes); `force` = `.md` files; `off` = raw. */
type MarkdownMode = 'auto' | 'force' | 'off';
/** What the preview slot of a multi share shows: the note, a file id, or nothing. */
type Selection = 'note' | number | null;

/**
 * Heuristic: does this text look like Markdown worth rendering?
 *
 * Plain notes and pasted logs should stay verbatim in a <pre> — rendering them
 * would silently eat leading `#` characters, collapse newlines, and so on. We
 * only switch to rendered mode when a recognisable block-level construct is
 * present.
 */
function looksLikeMarkdown(s: string): boolean {
  return [
    /^#{1,6}\s+\S/m,        // heading
    /^\s*[-*+]\s+\S/m,      // bullet list
    /^\s*\d+\.\s+\S/m,      // ordered list
    /^>\s+\S/m,             // blockquote
    /```/,                  // fenced code
    /\[[^\]]+\]\([^)]+\)/,  // link
    /(\*\*|__)\S[\s\S]*?\1/,// bold
    /^\s*\|.+\|\s*$/m,      // table row
    /^\s*(-{3,}|\*{3,})\s*$/m, // horizontal rule
  ].some((re) => re.test(s));
}

export function PickupDetail({item,onClose}:{item:ShareSelectResponse;onClose:()=>void}) {
  const {t}=useTranslation();
  const files:ShareMultiFile[]=item.kind==='multi'?(item.files||[]):item.kind==='file'?[{file_id:0,order:0,name:item.name||item.code,size:item.size||0,url:item.url,content_type:item.content_type,force_download:item.force_download}]:[];
  const mime=bareMime(item.content_type);
  const meta=item.kind==='text'?`${new Blob([item.text||'']).size} B · ${t('v2.detail.textKind')}`:item.kind==='multi'?`${t('v2.recent.fileCount',{n:item.file_count||files.length})} · ${fmt(item.total_size||0)}`:`${fmt(item.size||0)} · ${mime&&mime!=='application/octet-stream'?mime:t('v2.detail.fileKind')}`;
  // Multi shares preview one thing at a time: the note by default, else the
  // first file that has a preview. Keyed by code so a different share never
  // inherits a stale selection.
  const canPreview=(f:ShareMultiFile)=>item.kind==='multi'&&!!f.url&&previewKind(f.content_type,f.name)!==null;
  const [picked,setPicked]=useState<{code:string;sel:Selection}|null>(null);
  const selected:Selection=picked?.code===item.code?picked.sel:item.kind!=='multi'?null:item.text?'note':(files.find(canPreview)?.file_id??null);
  const select=(sel:Selection)=>{haptic();setPicked({code:item.code,sel});};
  const copy=(s:string)=>{haptic('success');void navigator.clipboard?.writeText(s).catch(()=>{});};
  // File shares download from the attachment proxy. Pure text shares have no
  // storage URL at all — they live inside the select response — so package the
  // in-memory body as a UTF-8 .txt Blob instead. The old `files.length > 0`
  // guard silently hid Download for every pure text share on desktop + mobile.
  const downloadCurrent=()=>{
    haptic();
    if(item.kind==='text'){
      triggerTextDownload(item.text||'',`${item.code}.txt`);
      return;
    }
    files.forEach((f,i)=>{if(!f.url)return;window.setTimeout(()=>triggerDownload(f.url,f.name),i*120)});
  };
  const hasDownload=item.kind==='text'||files.length>0;
  // Every close path plays the exit (`data-closing`, see v2/styles/base.css)
  // and unmounts once it has finished. Latched, so a second click during the
  // exit does nothing; reduced motion closes at once.
  const [closing,setClosing]=useState(false);
  const closingRef=useRef(false);
  const exitTimer=useRef<number>();
  useEffect(()=>()=>window.clearTimeout(exitTimer.current),[]);
  const requestClose=()=>{
    if(closingRef.current)return;
    closingRef.current=true;
    if(reducedMotion()){onClose();return;}
    setClosing(true);
    exitTimer.current=window.setTimeout(onClose,EXIT_MS);
  };
  return <div data-yd="backdrop" data-r="backdrop" data-closing={closing?'':undefined} onClick={requestClose} style={backdrop}>
    <div data-yd="dialog" data-r="sheet" onClick={e=>e.stopPropagation()} style={sheet}>
      <div data-r="grabber" style={{display:'none',padding:'10px 0 4px'}}><div style={{width:36,height:5,borderRadius:999,background:'var(--grab)',margin:'0 auto'}}/></div>
      <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'18px 20px 14px',borderBottom:'1px solid var(--ln)'}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:18,fontWeight:700,letterSpacing:'-.01em',color:'var(--tx)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name|| (item.kind==='text'?t('v2.recent.textShare'):item.code)}</div><div style={{fontSize:12,color:'var(--tx3)',marginTop:3}}>{meta}</div></div><button type="button" data-yd="icon-btn" onClick={requestClose} style={close}><Icon name="i-x" size={15}/></button></div>
      <div style={{padding:'16px 20px 20px'}}>
        {item.kind==='multi'?<MultiPreview item={item} files={files} selected={selected} onShowNote={()=>select('note')}/>:<Preview item={item}/>}
        {files.length>0&&<div style={{marginTop:14,border:'1px solid var(--ln)',borderRadius:12,overflow:'hidden'}}>{files.map((f,i)=>{
          const edge={borderTop:i?'1px solid var(--ln)':'none'};
          // Rows without a preview (and the single row of a file share) stay
          // one big download link, as before.
          if(!canPreview(f))return <a key={f.file_id||i} href={downloadHref(f.url)||'#'} download={f.name||undefined} rel="noopener noreferrer" onClick={()=>haptic()} style={{...row,...edge,padding:'11px 14px'}}><FileRowBody f={f}/><Icon name="i-dl" size={16} style={{color:'var(--act)',flexShrink:0}}/></a>;
          // Previewable rows: the row selects the preview, the icon downloads.
          const active=selected===f.file_id;
          return <div key={f.file_id} style={{...row,...edge,gap:0,background:active?'var(--p1)':'transparent'}}>
            <button type="button" aria-pressed={active} title={t('v2.detail.preview')} onClick={()=>select(f.file_id)} style={rowBtn}><FileRowBody f={f} active={active}/></button>
            <a href={downloadHref(f.url)||'#'} download={f.name||undefined} rel="noopener noreferrer" aria-label={t('v2.detail.download')} title={t('v2.detail.download')} onClick={()=>haptic()} style={rowDl}><Icon name="i-dl" size={16}/></a>
          </div>;
        })}</div>}
        <div data-r="pickup-actions" style={{display:'flex',gap:8,marginTop:16,flexWrap:'wrap'}}>{hasDownload&&<button type="button" data-yd="btn" data-r="download" onClick={downloadCurrent} style={primary}><Icon name="i-dl" size={16}/>{item.kind==='text'?t('v2.detail.download'):t('v2.detail.downloadAll')}</button>}<button type="button" data-yd="quiet" onClick={()=>copy(item.code)} style={quiet}><Icon name="i-copy" size={15}/>{t('v2.detail.copyCode')}</button><button type="button" data-yd="quiet" onClick={()=>copy(`${location.origin}/s/${item.code}`)} style={quiet}><Icon name="i-link" size={15}/>{t('v2.detail.shareLink')}</button></div>
      </div>
    </div>
  </div>;
}
function FileRowBody({f,active=false}:{f:ShareMultiFile;active?:boolean}){
  return <>
    <Icon name={active?'i-eye':iconFor(f.content_type)} size={16} style={{color:active?'var(--act)':'var(--tx3)',flexShrink:0}}/>
    <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:active?600:undefined}}>{f.name}</span>
    <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:'var(--tx3)'}}>{fmt(f.size)}</span>
  </>;
}

function Preview({item}:{item:ShareSelectResponse}){
  if(item.kind==='text')return <TextPreview text={item.text||''} markdown="auto"/>;
  return <FilePreview key={item.code} file={{url:item.url,name:item.name,size:item.size,content_type:item.content_type}}/>;
}

/** Preview slot of a multi share: the note, or the file picked in the list. */
function MultiPreview({item,files,selected,onShowNote}:{item:ShareSelectResponse;files:ShareMultiFile[];selected:Selection;onShowNote:()=>void}){
  const {t}=useTranslation();
  if(selected==='note'&&item.text)return <NotePreview text={item.text}/>;
  const f=files.find((x)=>x.file_id===selected);
  if(!f)return <div style={placeholder}><Icon name="i-folder" size={26}/><span style={{fontSize:13}}>{t('v2.detail.multiShare')}</span></div>;
  return <div>
    <div style={caption}>
      <span style={captionLabel}>{f.name}</span>
      {item.text&&<button type="button" data-yd="quiet" onClick={onShowNote} style={noteCopy}><Icon name="i-pen" size={13}/>{t('v2.detail.note')}</button>}
    </div>
    <FilePreview key={f.file_id} file={f}/>
  </div>;
}

/**
 * One file's preview, chosen from the server-reported type (the exact type the
 * download proxy serves) plus the extension rules in `lib/preview`. Media that
 * the browser cannot decode (HEIC outside Safari, an unsupported codec) falls
 * back to the placeholder instead of showing a broken widget.
 */
function FilePreview({file}:{file:{url:string|null;name:string|null;size:number|null;content_type:string|null}}){
  const {t}=useTranslation();
  const [failed,setFailed]=useState(false);
  const fail=()=>setFailed(true);
  const url=file.url;
  const kind=url?previewKind(file.content_type,file.name):null;
  if(!url||!kind||failed)return <div style={placeholder}><Icon name={iconFor(file.content_type)} size={26}/><span style={{fontSize:13,textAlign:'center',padding:'0 16px'}}>{failed?t('v2.detail.previewFailed'):t('v2.detail.downloadable')}</span></div>;
  if(kind==='image')return <img src={url} alt={file.name||''} onError={fail} style={media}/>;
  if(kind==='video')return <video controls preload="metadata" src={url} onError={fail} style={media}/>;
  if(kind==='audio')return <div style={placeholder}><audio controls preload="metadata" src={url} onError={fail} style={{width:'90%'}}/></div>;
  // Hide the thumbnail sidebar and fit the page to the sheet width; without
  // this Chromium opens the viewer with a ~300px sidebar and clips the page.
  if(kind==='pdf')return <iframe src={`${url}#navpanes=0&view=FitH`} title={file.name||'PDF'} style={{...media,height:'52vh'}}/>;
  // Text files (.md, .txt, .json, .log, .yaml, source code…): fetch the body
  // and reuse the text renderer.
  return <RemoteTextPreview url={url} size={file.size} name={file.name} contentType={file.content_type}/>;
}

/**
 * The note attached to a multi-file share. Same renderer as a text share, plus
 * a copy button: unlike a text share there is no Download for the note itself.
 */
function NotePreview({text}:{text:string}){
  const {t}=useTranslation();
  const [copied,setCopied]=useState(false);
  const copy=()=>{
    const done=(ok:boolean)=>{
      haptic(ok?'success':'error');
      if(ok){setCopied(true);window.setTimeout(()=>setCopied(false),1400);}
    };
    if(navigator.clipboard?.writeText){
      void navigator.clipboard.writeText(text).then(()=>done(true),()=>done(legacyCopy(text)));
    }else{
      done(legacyCopy(text));
    }
  };
  return <div>
    <div style={caption}>
      <span style={captionLabel}>{t('v2.detail.note')}</span>
      <button type="button" data-yd="quiet" onClick={copy} style={noteCopy}><Icon name="i-copy" size={13}/>{copied?t('v2.detail.copied'):t('v2.detail.copyText')}</button>
    </div>
    <TextPreview text={text} markdown="auto" compact/>
  </div>;
}

/**
 * Fetches an uploaded text file and hands it to {@link TextPreview}.
 *
 * Hits the plain (inline) proxy URL — no `?dl=1` — so previewing never counts
 * as an attachment download. Body size is capped inside `fetchTextPreview`.
 */
function RemoteTextPreview({url,size,name,contentType}:{url:string;size:number|null;name:string|null;contentType:string|null}){
  const {t}=useTranslation();
  const [state,setState]=useState<{status:'loading'}|{status:'ok';text:string;truncated:boolean}|{status:'error'}>({status:'loading'});
  useEffect(()=>{
    const ac=new AbortController();
    setState({status:'loading'});
    fetchTextPreview(url,size,ac.signal)
      .then((r)=>setState({status:'ok',text:r.text,truncated:r.truncated}))
      .catch((e)=>{if((e as Error)?.name!=='AbortError')setState({status:'error'});});
    return ()=>ac.abort();
  },[url,size]);

  if(state.status==='loading')return <div style={placeholder}><span style={{fontSize:13}}>{t('v2.detail.loadingPreview')}</span></div>;
  if(state.status==='error')return <div style={placeholder}><Icon name="i-file" size={26}/><span style={{fontSize:13}}>{t('v2.detail.previewFailed')}</span></div>;
  // CSV / TSV get a table. Only Markdown files render as Markdown; JSON,
  // source code and logs stay verbatim: the heuristic would misread a
  // `# comment` or `| a | b |`.
  const flavor=tableFlavor(contentType,name);
  if(flavor)return <TablePreview text={state.text} delimiter={flavor==='tsv'?'\t':sniffDelimiter(state.text)} truncated={state.truncated}/>;
  return <TextPreview text={state.text} markdown={isMarkdownName(name)?'force':'off'} truncated={state.truncated}/>;
}

/**
 * CSV / TSV as a table, with a toggle to the raw text like the Markdown one.
 * Cells are plain React text nodes, so nothing in the file is ever parsed as
 * HTML. Falls back to the raw `<pre>` when the text does not parse into at
 * least two columns.
 */
function TablePreview({text,delimiter,truncated}:{text:string;delimiter:string;truncated:boolean}){
  const {t}=useTranslation();
  const [raw,setRaw]=useState(false);
  const table=useMemo(()=>{
    try{
      const parsed=parseTable(text,delimiter,{maxRows:TABLE_MAX_ROWS,maxCols:TABLE_MAX_COLS});
      return parsed.columns>=2?parsed:null;
    }catch{
      return null;
    }
  },[text,delimiter]);
  if(!table)return <TextPreview text={text} markdown="off" truncated={truncated}/>;
  if(raw)return <div style={{position:'relative'}}>
    <button type="button" data-yd="quiet" onClick={()=>{haptic();setRaw(false);}} style={toggle}>{t('v2.detail.table')}</button>
    <TextPreview text={text} markdown="off" truncated={truncated}/>
  </div>;
  const [head,...body]=table.rows;
  return <div style={{position:'relative'}}>
    <button type="button" data-yd="quiet" onClick={()=>{haptic();setRaw(true);}} style={toggle}>{t('v2.detail.raw')}</button>
    <div data-r="csv" style={tableBox}>
      <table>
        <thead><tr>{head.map((c,i)=><th key={i}>{c}</th>)}</tr></thead>
        <tbody>{body.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {(table.rowsCut||table.colsCut)&&<div style={truncNote}>{t('v2.detail.tableCut',{rows:TABLE_MAX_ROWS,cols:TABLE_MAX_COLS})}</div>}
    {truncated&&<div style={truncNote}>{t('v2.detail.previewTruncated')}</div>}
  </div>;
}

/**
 * Text preview. Markdown renders as HTML (sanitized by `renderMarkdown`), with
 * a toggle back to the raw source; anything else stays verbatim so pasted logs
 * and code are never mangled.
 *
 * `markdown`: `auto` applies the {@link looksLikeMarkdown} heuristic (pasted
 * text shares and notes, which have no extension); `force` is for uploaded
 * `.md` files, where the extension is a stronger signal than the heuristic;
 * `off` keeps every other uploaded file raw.
 *
 * `compact` drops the minimum height for short notes that sit above a file list.
 */
function TextPreview({text,markdown,truncated=false,compact=false}:{text:string;markdown:MarkdownMode;truncated?:boolean;compact?:boolean}){
  const {t}=useTranslation();
  const box=compact?textBoxCompact:textBox;
  const isMd=useMemo(()=>markdown==='force'||(markdown==='auto'&&looksLikeMarkdown(text)),[markdown,text]);
  const [raw,setRaw]=useState(false);
  const html=useMemo(()=>(isMd&&!raw?renderMarkdown(text):''),[isMd,raw,text]);
  const mdRef=useRef<HTMLDivElement>(null);
  const [copiedIdx,setCopiedIdx]=useState<number|null>(null);

  // Attach a copy button to every rendered code block. Done as an effect on
  // the real DOM because the HTML comes from markdown-it as a string, so there
  // are no React elements to decorate.
  useEffect(()=>{
    const root=mdRef.current;
    if(!root||raw||!isMd)return;
    const blocks=[...root.querySelectorAll('pre')];
    const cleanups:Array<()=>void>=[];
    blocks.forEach((pre,i)=>{
      if(pre.querySelector('[data-yd="codecopy"]'))return;
      pre.style.position='relative';
      const btn=document.createElement('button');
      btn.type='button';
      btn.dataset.yd='codecopy';
      btn.setAttribute('aria-label',t('v2.detail.copyCodeBlock'));
      btn.innerHTML=COPY_SVG;
      const onClick=(e:MouseEvent)=>{
        e.stopPropagation();
        const code=pre.querySelector('code');
        const src=code?.textContent??pre.textContent??'';
        // Fall back to execCommand when the async clipboard is unavailable
        // (insecure origin, permission denied) so the button is never a no-op.
        const done=(ok:boolean)=>{
          haptic(ok?'success':'error');
          if(ok){setCopiedIdx(i);window.setTimeout(()=>setCopiedIdx(null),1400);}
        };
        if(navigator.clipboard?.writeText){
          void navigator.clipboard.writeText(src).then(()=>done(true),()=>done(legacyCopy(src)));
        }else{
          done(legacyCopy(src));
        }
      };
      btn.addEventListener('click',onClick);
      pre.appendChild(btn);
      cleanups.push(()=>{btn.removeEventListener('click',onClick);btn.remove();});
    });
    return ()=>cleanups.forEach((f)=>f());
  },[html,raw,isMd,t]);

  // Reflect the "copied" state without re-running the attach effect.
  useEffect(()=>{
    const root=mdRef.current;
    if(!root)return;
    root.querySelectorAll('[data-yd="codecopy"]').forEach((b: Element, i: number) => {
      b.classList.toggle('is-copied', i === copiedIdx);
    });
  },[copiedIdx,html]);

  if(!isMd||raw)return <div style={{position:'relative'}}>
    {isMd&&<button type="button" data-yd="quiet" onClick={()=>{haptic();setRaw(false);}} style={toggle}>{t('v2.detail.rendered')}</button>}
    <pre style={{...box,...rawText}}>{text}</pre>
    {truncated&&<div style={truncNote}>{t('v2.detail.previewTruncated')}</div>}
  </div>;
  return <div style={{position:'relative'}}>
    <button type="button" data-yd="quiet" onClick={()=>{haptic();setRaw(true);}} style={toggle}>{t('v2.detail.raw')}</button>
    <div ref={mdRef} data-r="md" style={box} dangerouslySetInnerHTML={{__html:html}}/>
    {truncated&&<div style={truncNote}>{t('v2.detail.previewTruncated')}</div>}
  </div>;
}

/** Inline copy glyph for the code-block button (matches the Lucide sprite). */
const COPY_SVG='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

/**
 * Clipboard fallback for contexts where the async Clipboard API is blocked
 * (non-HTTPS origins, denied permission). Returns whether the copy succeeded.
 */
function legacyCopy(text:string):boolean{
  try{
    const ta=document.createElement('textarea');
    ta.value=text;
    ta.setAttribute('readonly','');
    ta.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok=document.execCommand('copy');
    ta.remove();
    return ok;
  }catch{
    return false;
  }
}
function iconFor(ct:string|null){return ct?.startsWith('image/')?'i-img':ct?.startsWith('video/')?'i-vid':ct?.startsWith('audio/')?'i-audio':'i-file';}
function fmt(n:number){if(n<1024)return`${n} B`;if(n<1024**2)return`${(n/1024).toFixed(1)} KB`;if(n<1024**3)return`${(n/1024**2).toFixed(1)} MB`;return`${(n/1024**3).toFixed(1)} GB`;}
const backdrop:React.CSSProperties={position:'fixed',inset:0,zIndex:60,background:'rgba(4,6,10,.55)',display:'flex',alignItems:'center',justifyContent:'center',padding:24};
/* Was 520px / 86vh, which left the preview cramped — especially for text and
   Markdown shares. Widened; height stays content-driven with a 70vh cap so a
   short share does not leave dead space under the action row. */
const sheet:React.CSSProperties={width:'min(760px, 100%)',maxWidth:'100%',maxHeight:'70vh',display:'flex',flexDirection:'column',overflow:'auto',background:'var(--pn)',border:'1px solid var(--ln)',borderRadius:16,boxShadow:'var(--shl)'};
const close:React.CSSProperties={width:30,height:30,borderRadius:8,border:'1px solid var(--ln)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--tx2)',cursor:'pointer',flexShrink:0,background:'transparent'};
const placeholder:React.CSSProperties={height:200,borderRadius:12,background:'var(--p1)',border:'1px solid var(--ln)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'var(--tx3)'};
const media:React.CSSProperties={width:'100%',maxHeight:'40vh',objectFit:'contain',borderRadius:12,background:'var(--p1)',border:'1px solid var(--ln)'};
/* Shared frame of the raw <pre> and the rendered Markdown container so toggling
   between them does not resize the dialog. It must not carry `white-space`:
   an inline `pre-wrap` here beat the `[data-r='md']` stylesheet reset and turned
   every source newline into a visible gap between paragraphs and list items. */
const textBox:React.CSSProperties={minHeight:140,maxHeight:'40vh',overflow:'auto',margin:0,borderRadius:12,background:'var(--p1)',border:'1px solid var(--ln)',padding:14,wordBreak:'break-word',fontFamily:'inherit',fontSize:13.5,lineHeight:1.7,color:'var(--tx1)'};
const textBoxCompact:React.CSSProperties={...textBox,minHeight:0,maxHeight:'28vh'};
/* Raw source only: keep its line breaks. */
const rawText:React.CSSProperties={whiteSpace:'pre-wrap'};
/* Scrolls both ways inside the sheet; cell styling is `[data-r='csv']` in
   v2/styles/base.css. Panel fill so the --p1 header row stands out.
   `isolation` keeps the sticky header's z-index inside the frame, so it can
   never paint over the 原文 toggle. */
const tableBox:React.CSSProperties={maxHeight:'40vh',overflow:'auto',isolation:'isolate',borderRadius:12,background:'var(--pn)',border:'1px solid var(--ln)',fontSize:12.5,lineHeight:1.5,color:'var(--tx)'};
const caption:React.CSSProperties={display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:8,minHeight:26};
const captionLabel:React.CSSProperties={fontSize:12,color:'var(--tx3)',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'};
const row:React.CSSProperties={display:'flex',alignItems:'center',gap:10,fontSize:14,color:'var(--tx1)'};
const rowBtn:React.CSSProperties={flex:1,minWidth:0,display:'flex',alignItems:'center',gap:10,padding:'11px 0 11px 14px',border:0,background:'transparent',color:'inherit',font:'inherit',textAlign:'left',cursor:'pointer'};
const rowDl:React.CSSProperties={display:'flex',alignItems:'center',alignSelf:'stretch',padding:'0 14px 0 10px',color:'var(--act)',flexShrink:0};
const noteCopy:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:5,fontSize:12,padding:'4px 9px',border:'1px solid var(--ln)',borderRadius:7,background:'transparent',color:'var(--tx2)',fontFamily:'inherit',cursor:'pointer'};
const toggle:React.CSSProperties={position:'absolute',top:8,right:8,zIndex:1,fontSize:11.5,padding:'3px 9px',border:'1px solid var(--ln2)',borderRadius:7,background:'var(--pn)',color:'var(--tx2)',fontFamily:'inherit',cursor:'pointer'};
/* Shown under a preview that hit the 512 KB read cap, so nobody assumes the
   truncated body is the whole file — the download always carries everything. */
const truncNote:React.CSSProperties={marginTop:8,fontSize:12,color:'var(--tx3)'};
const primary:React.CSSProperties={flex:1,minWidth:150,height:46,border:0,borderRadius:10,background:'var(--ac)',color:'#fff',fontFamily:'inherit',fontSize:15,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8};const quiet:React.CSSProperties={height:46,padding:'0 16px',border:'1px solid var(--ln2)',borderRadius:10,background:'transparent',color:'var(--tx1)',fontFamily:'inherit',fontSize:14,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7};
