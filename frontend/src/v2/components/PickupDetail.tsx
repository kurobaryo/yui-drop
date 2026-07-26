import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ShareMultiFile, ShareSelectResponse } from '@/lib/api/share';
import { renderMarkdown } from '@/lib/markdown';
import { Icon } from './IconSprite';

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
  const meta=item.kind==='text'?`${new Blob([item.text||'']).size} B · ${t('v2.detail.textKind')}`:item.kind==='multi'?`${t('v2.recent.fileCount',{n:item.file_count||files.length})} · ${fmt(item.total_size||0)}`:`${fmt(item.size||0)} · ${item.content_type||t('v2.detail.fileKind')}`;
  const copy=(s:string)=>void navigator.clipboard?.writeText(s).catch(()=>{});
  const downloadAll=()=>{files.forEach((f,i)=>{if(!f.url)return;window.setTimeout(()=>window.open(f.url!,'_blank','noopener'),i*120)});};
  return <div data-yd="backdrop" data-r="backdrop" onClick={onClose} style={backdrop}>
    <div data-yd="dialog" data-r="sheet" onClick={e=>e.stopPropagation()} style={sheet}>
      <div data-r="grabber" style={{display:'none',padding:'10px 0 4px'}}><div style={{width:36,height:5,borderRadius:999,background:'var(--grab)',margin:'0 auto'}}/></div>
      <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'18px 20px 14px',borderBottom:'1px solid var(--ln)'}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:18,fontWeight:700,letterSpacing:'-.01em',color:'var(--tx)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name|| (item.kind==='text'?t('v2.recent.textShare'):item.code)}</div><div style={{fontSize:12,color:'var(--tx3)',marginTop:3}}>{meta}</div></div><button type="button" data-yd="icon-btn" onClick={onClose} style={close}><Icon name="i-x" size={15}/></button></div>
      <div style={{padding:'16px 20px 20px'}}>
        <Preview item={item}/>
        {files.length>0&&<div style={{marginTop:14,border:'1px solid var(--ln)',borderRadius:12,overflow:'hidden'}}>{files.map((f,i)=><a key={f.file_id||i} href={f.url||'#'} target="_blank" rel="noopener noreferrer" style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',borderTop:i?'1px solid var(--ln)':'none',fontSize:14,color:'var(--tx1)'}}><Icon name={iconFor(f.content_type)} size={16} style={{color:'var(--tx3)',flexShrink:0}}/><span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:'var(--tx3)'}}>{fmt(f.size)}</span><Icon name="i-dl" size={16} style={{color:'var(--act)',flexShrink:0}}/></a>)}</div>}
        <div style={{display:'flex',gap:8,marginTop:16,flexWrap:'wrap'}}>{files.length>0&&<button type="button" data-yd="btn" onClick={downloadAll} style={primary}><Icon name="i-dl" size={16}/>{t('v2.detail.downloadAll')}</button>}<button type="button" data-yd="quiet" onClick={()=>copy(item.code)} style={quiet}><Icon name="i-copy" size={15}/>{t('v2.detail.copyCode')}</button><button type="button" data-yd="quiet" onClick={()=>copy(`${location.origin}/s/${item.code}`)} style={quiet}><Icon name="i-link" size={15}/>{t('v2.detail.shareLink')}</button></div>
      </div>
    </div>
  </div>;
}
function Preview({item}:{item:ShareSelectResponse}){
  const {t}=useTranslation();
  if(item.kind==='text')return <TextPreview text={item.text||''}/>;
  const url=item.url;const ct=item.content_type||'';if(url&&ct.startsWith('image/'))return <img src={url} alt={item.name||undefined} style={media}/>;if(url&&ct.startsWith('video/'))return <video controls src={url} style={media}/>;if(url&&ct.startsWith('audio/'))return <div style={placeholder}><audio controls src={url} style={{width:'90%'}}/></div>;if(url&&ct==='application/pdf')return <iframe src={url} title={item.name||'PDF'} style={{...media,height:'52vh'}}/>;return <div style={placeholder}><Icon name={iconFor(ct)} size={26}/><span style={{fontSize:13}}>{item.kind==='multi'?t('v2.detail.multiShare'):ct||t('v2.detail.downloadable')}</span></div>;}

/**
 * Text share preview. Markdown-looking content renders as HTML (sanitized by
 * `renderMarkdown`), with a toggle back to the raw source; anything else stays
 * verbatim so pasted logs and code are never mangled.
 */
function TextPreview({text}:{text:string}){
  const {t}=useTranslation();
  const isMd=useMemo(()=>looksLikeMarkdown(text),[text]);
  const [raw,setRaw]=useState(false);
  const html=useMemo(()=>(isMd&&!raw?renderMarkdown(text):''),[isMd,raw,text]);
  if(!isMd||raw)return <div style={{position:'relative'}}>
    {isMd&&<button type="button" data-yd="quiet" onClick={()=>setRaw(false)} style={toggle}>{t('v2.detail.rendered')}</button>}
    <pre style={pre}>{text}</pre>
  </div>;
  return <div style={{position:'relative'}}>
    <button type="button" data-yd="quiet" onClick={()=>setRaw(true)} style={toggle}>{t('v2.detail.raw')}</button>
    <div data-r="md" style={pre} dangerouslySetInnerHTML={{__html:html}}/>
  </div>;
}
function iconFor(ct:string|null){return ct?.startsWith('image/')?'i-img':ct?.startsWith('video/')?'i-vid':ct?.startsWith('audio/')?'i-file':'i-file';}
function fmt(n:number){if(n<1024)return`${n} B`;if(n<1024**2)return`${(n/1024).toFixed(1)} KB`;if(n<1024**3)return`${(n/1024**2).toFixed(1)} MB`;return`${(n/1024**3).toFixed(1)} GB`;}
const backdrop:React.CSSProperties={position:'fixed',inset:0,zIndex:60,background:'rgba(4,6,10,.55)',display:'flex',alignItems:'center',justifyContent:'center',padding:24};
/* Was 520px / 86vh, which left the preview cramped — especially for text and
   Markdown shares. Widened and allowed to use most of the viewport height. */
const sheet:React.CSSProperties={width:'min(760px, 100%)',maxWidth:'100%',maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'auto',background:'var(--pn)',border:'1px solid var(--ln)',borderRadius:16,boxShadow:'var(--shl)'};
const close:React.CSSProperties={width:30,height:30,borderRadius:8,border:'1px solid var(--ln)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--tx2)',cursor:'pointer',flexShrink:0,background:'transparent'};
const placeholder:React.CSSProperties={height:200,borderRadius:12,background:'var(--p1)',border:'1px solid var(--ln)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'var(--tx3)'};
const media:React.CSSProperties={width:'100%',maxHeight:'52vh',objectFit:'contain',borderRadius:12,background:'var(--p1)',border:'1px solid var(--ln)'};
/* Shared by the raw <pre> and the rendered Markdown container so toggling
   between them does not resize the dialog. */
const pre:React.CSSProperties={minHeight:200,maxHeight:'52vh',overflow:'auto',margin:0,borderRadius:12,background:'var(--p1)',border:'1px solid var(--ln)',padding:14,whiteSpace:'pre-wrap',wordBreak:'break-word',fontFamily:'inherit',fontSize:13.5,lineHeight:1.7,color:'var(--tx1)'};
const toggle:React.CSSProperties={position:'absolute',top:8,right:8,zIndex:1,fontSize:11.5,padding:'3px 9px',border:'1px solid var(--ln2)',borderRadius:7,background:'var(--pn)',color:'var(--tx2)',fontFamily:'inherit',cursor:'pointer'};
const primary:React.CSSProperties={flex:1,minWidth:150,height:46,border:0,borderRadius:10,background:'var(--ac)',color:'#fff',fontFamily:'inherit',fontSize:15,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8};const quiet:React.CSSProperties={height:46,padding:'0 16px',border:'1px solid var(--ln2)',borderRadius:10,background:'transparent',color:'var(--tx1)',fontFamily:'inherit',fontSize:14,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7};
