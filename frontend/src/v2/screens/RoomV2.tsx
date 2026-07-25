import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '@/lib/api';
import {
  joinCollection, listFiles, listMessages, previewCollection, sendMessage,
  triggerFileDownload, type CollectionFile, type CollectionMessage,
  type PreviewCollectionResponse,
} from '@/lib/api/collection';
import { CollectionSse } from '@/lib/collectionSse';
import { uploadFilesToCollection, type StorageBackend } from '@/lib/uploader';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { useCollectionMemberStore } from '@/stores/collectionMember';
import { pushRecent } from '@/lib/recent';
import { toast } from '@/components/ui/Toast';
import { Icon } from '../components/IconSprite';

function fmt(n:number){if(n<1024)return`${n} B`;if(n<1024**2)return`${(n/1024).toFixed(1)} KB`;if(n<1024**3)return`${(n/1024**2).toFixed(1)} MB`;return`${(n/1024**3).toFixed(1)} GB`;}
function fileIcon(t:string|null){return t?.startsWith('image/')?'i-img':t?.startsWith('video/')?'i-vid':'i-file';}

export function RoomV2() {
  const {code:raw}=useParams(); const code=(raw||'').toUpperCase(); const navigate=useNavigate();
  const config=usePublicConfig(); const member=useCollectionMemberStore(s=>s.members[code]); const setMember=useCollectionMemberStore(s=>s.set);
  const [preview,setPreview]=useState<PreviewCollectionResponse|null>(null); const [error,setError]=useState('');
  const [files,setFiles]=useState<CollectionFile[]>([]); const [messages,setMessages]=useState<CollectionMessage[]>([]);
  const [uploading,setUploading]=useState(false); const [progress,setProgress]=useState(0); const [message,setMessage]=useState('');
  const inputRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{let live=true;previewCollection(code).then(x=>live&&setPreview(x)).catch(e=>live&&setError(e instanceof ApiError?e.message:'收集箱不存在'));return()=>{live=false};},[code]);
  const refresh=useCallback(async()=>{if(!member?.memberToken)return;try{const [f,m]=await Promise.all([listFiles(code,member.memberToken),listMessages(code,member.memberToken,{limit:100})]);setFiles(f.files);setMessages(m.messages.slice().reverse());}catch(e){toast.error(e instanceof ApiError?e.message:'读取收集箱失败');}},[code,member?.memberToken]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{if(!member?.memberToken)return;const sse=new CollectionSse(code,member.memberToken,{onFile:f=>setFiles(x=>x.some(v=>v.id===f.id)?x:[...x,f]),onMessage:m=>setMessages(x=>x.some(v=>v.id===m.id)?x:[...x,m]),onClosed:()=>{},onDeleted:d=>{if(d.kind==='file')setFiles(x=>x.filter(v=>v.id!==d.id));else setMessages(x=>x.filter(v=>v.id!==d.id));}});sse.start();return()=>sse.close();},[code,member?.memberToken]);

  const upload=async(list:FileList|null)=>{if(!list?.length||!member?.memberToken||uploading)return;setUploading(true);setProgress(0);try{const h=uploadFilesToCollection({collectionCode:code,memberToken:member.memberToken,files:Array.from(list),storageBackend:(config.storage_backend||'local') as StorageBackend,onOverallProgress:v=>setProgress(v*100)});await h.promise;await refresh();}catch(e){toast.error(e instanceof ApiError?e.message:'上传失败');}finally{setUploading(false);setProgress(0);if(inputRef.current)inputRef.current.value='';}};
  const post=async()=>{if(!message.trim()||!member?.memberToken)return;try{const m=await sendMessage(code,member.memberToken,{text:message.trim()});setMessages(x=>x.some(v=>v.id===m.id)?x:[...x,m]);setMessage('');}catch(e){toast.error(e instanceof ApiError?e.message:'发送失败');}};

  if(error)return <Status text={error} back={()=>navigate('/')}/>;
  if(!preview)return <Status text="正在打开收集箱…" back={()=>navigate('/')}/>;
  if(!preview.visible||preview.closed)return <Status text="收集箱已关闭或过期" back={()=>navigate('/')}/>;

  return <>
    <div data-r="pad" style={{maxWidth:920,width:'100%',margin:'0 auto',padding:'32px 24px 40px',flex:1}}>
      <button type="button" onClick={()=>navigate('/')} style={back}><Icon name="i-arr" size={14} style={{transform:'rotate(180deg)'}}/>返回首页</button>
      <div style={{display:'flex',alignItems:'flex-end',gap:14,flexWrap:'wrap'}}><div style={{flex:1,minWidth:240}}><div style={{fontSize:12,color:'var(--tx3)',marginBottom:6}}>收集箱{member?.isCreator?' · 我创建的':''}</div><h1 style={{fontSize:28,fontWeight:700,letterSpacing:'-.02em',color:'var(--tx)'}}>{preview.name||'未命名收集箱'}</h1></div><div style={{display:'flex',alignItems:'center',gap:8}}><span style={codeChip}>{code}</span><button type="button" data-yd="quiet" onClick={()=>void navigator.clipboard?.writeText(location.href)} style={quiet}><Icon name="i-link" size={14}/>复制链接</button></div></div>
      <div style={{marginTop:12,display:'flex',gap:18,fontSize:12,color:'var(--tx3)',flexWrap:'wrap'}}><span style={meta}><Icon name="i-users" size={13}/>{preview.member_count} 人</span><span style={meta}><Icon name="i-hdd" size={13}/>{files.length} 个文件 · {fmt(files.reduce((a,f)=>a+f.size,0))}</span></div>
      <div data-yd="drop" onClick={()=>inputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void upload(e.dataTransfer.files)}} style={{marginTop:24,border:'1.5px dashed var(--ln2)',borderRadius:12,padding:'26px 20px',background:'var(--acs)',display:'flex',alignItems:'center',gap:14,cursor:member?'pointer':'not-allowed',opacity:member?1:.55}}><Icon name="i-up" size={22} style={{color:'var(--ac)'}}/><div><div style={{fontSize:15,fontWeight:600,color:'var(--tx)'}}>拖入文件投递到这个收集箱</div><div style={{fontSize:12,color:'var(--tx3)'}}>单文件上限 {preview.max_file_bytes!=null?fmt(preview.max_file_bytes):'不限'} · {preview.visibility==='creator_only'?'仅创建者可见':'投递后所有人可见'}</div></div><input ref={inputRef} hidden type="file" multiple disabled={!member} onChange={e=>void upload(e.target.files)}/></div>
      {uploading&&<div style={{marginTop:8,height:5,borderRadius:99,background:'var(--p1)',overflow:'hidden'}}><div style={{width:`${progress}%`,height:'100%',background:'var(--ac)'}}/></div>}
      <div data-r="two-col" style={{marginTop:24,display:'grid',gridTemplateColumns:'1fr 300px',gap:24,alignItems:'start'}}>
        <div><div style={section}>文件 · {files.length}</div><div style={list}>{files.map((f,i)=><button key={f.id} type="button" data-yd="row" onClick={()=>member&&void triggerFileDownload(code,f.id,member.memberToken)} style={{...row,borderTop:i?'1px solid var(--ln)':'none'}}><Icon name={fileIcon(f.content_type)} size={18} style={{color:'var(--tx3)',flexShrink:0}}/><div style={{flex:1,minWidth:0,textAlign:'left'}}><div style={{fontSize:14,color:'var(--tx1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</div><div style={{fontSize:12,color:'var(--tx3)'}}>{f.nickname} · {fmt(f.size)}</div></div><Icon name="i-dl" size={16} style={{color:'var(--act)',flexShrink:0}}/></button>)}{!files.length&&<Empty text="还没有文件"/>}</div></div>
        <div><div style={section}>留言</div><div style={{...list,padding:12,display:'flex',flexDirection:'column',gap:12}}>{messages.slice(-20).map((m,i)=><div key={m.id}>{i>0&&<div style={{height:1,background:'var(--ln)',marginBottom:12}}/>}<div style={{fontSize:12,color:'var(--tx3)',marginBottom:3}}>{m.nickname} · {new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div><div style={{fontSize:13,color:'var(--tx1)'}}>{m.body}</div></div>)}{!messages.length&&<Empty text={preview.allow_messages===false?'该收集箱已关闭留言':'暂无留言'}/>}{preview.allow_messages!==false&&<div style={{display:'flex',gap:8,marginTop:2}}><input value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void post()}} placeholder="写点什么…" disabled={!member} style={msgInput}/><button type="button" data-yd="btn" onClick={()=>void post()} disabled={!member||!message.trim()} style={send}>发送</button></div>}</div></div>
      </div>
    </div>
    {!member&&<JoinDialog code={code} preview={preview} onJoined={(token,nick,isCreator)=>{setMember(code,{memberToken:token,nickname:nick,isCreator});pushRecent({code,kind:'collection',name:preview.name,created_at:new Date().toISOString(),isCreator});}}/>}
  </>;
}

function JoinDialog({code,preview,onJoined}:{code:string;preview:PreviewCollectionResponse;onJoined:(t:string,n:string,c:boolean)=>void}){const [nick,setNick]=useState('');const [pw,setPw]=useState('');const [busy,setBusy]=useState(false);const join=async()=>{if(!nick.trim())return;setBusy(true);try{const r=await joinCollection(code,{nickname:nick.trim(),entry_password:preview.has_entry_password?pw:null});onJoined(r.member_token,nick.trim(),!!r.is_creator);}catch(e){toast.error(e instanceof ApiError?e.message:'加入失败');setBusy(false);}};return <div data-yd="backdrop" data-r="backdrop" style={{position:'fixed',inset:0,zIndex:60,background:'rgba(4,6,10,.55)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}><div data-yd="dialog" data-r="sheet" style={{width:380,maxWidth:'100%',background:'var(--pn)',border:'1px solid var(--ln)',borderRadius:14,padding:22,boxShadow:'var(--shl)'}}><div data-r="grabber"/><div style={{fontSize:12,color:'var(--tx3)'}}>收集箱 · {code}</div><h2 style={{fontSize:20,color:'var(--tx)',marginTop:5}}>先起一个昵称</h2><p style={{fontSize:13,color:'var(--tx3)'}}>昵称会显示在你上传的文件和留言旁边。</p><input autoFocus value={nick} onChange={e=>setNick(e.target.value)} placeholder="你的昵称" style={dialogInput}/>{preview.has_entry_password&&<input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="进入密码" style={{...dialogInput,marginTop:8}}/>}<button type="button" data-yd="btn" onClick={()=>void join()} disabled={busy||!nick.trim()} style={{...send,width:'100%',height:44,marginTop:12}}>{busy?'加入中…':'进入收集箱'}</button></div></div>;}
function Status({text,back:onBack}:{text:string;back:()=>void}){return <div style={{flex:1,display:'grid',placeItems:'center',padding:24}}><div style={{textAlign:'center'}}><div style={{color:'var(--tx)',fontSize:17}}>{text}</div><button type="button" onClick={onBack} style={{...quiet,marginTop:14}}>返回首页</button></div></div>;}
function Empty({text}:{text:string}){return <div style={{padding:18,textAlign:'center',fontSize:12,color:'var(--tx3)'}}>{text}</div>;}
const back:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,fontSize:13,color:'var(--tx2)',cursor:'pointer',marginBottom:18,border:0,background:'transparent',fontFamily:'inherit',padding:0};
const quiet:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,fontSize:13,color:'var(--tx2)',border:'1px solid var(--ln)',borderRadius:8,padding:'7px 11px',cursor:'pointer',background:'transparent',fontFamily:'inherit'};
const codeChip:React.CSSProperties={fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:600,color:'var(--act)',background:'var(--acs)',padding:'6px 12px',borderRadius:8};
const meta:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6}; const section:React.CSSProperties={fontSize:13,fontWeight:600,color:'var(--tx)',marginBottom:10,lineHeight:'20px',height:20}; const list:React.CSSProperties={border:'1px solid var(--ln)',borderRadius:12,overflow:'hidden',background:'var(--pn)'};
const row:React.CSSProperties={width:'100%',display:'flex',alignItems:'center',gap:12,padding:'11px 14px',border:0,background:'transparent',cursor:'pointer',fontFamily:'inherit'};
const msgInput:React.CSSProperties={flex:1,minWidth:0,height:36,padding:'0 10px',border:'1px solid var(--ln2)',borderRadius:8,background:'var(--p2)',color:'var(--tx1)',fontFamily:'inherit',fontSize:13,outline:'none',boxSizing:'border-box'};const send:React.CSSProperties={height:36,padding:'0 14px',border:0,borderRadius:8,background:'var(--ac)',color:'#fff',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'};const dialogInput:React.CSSProperties={width:'100%',height:42,padding:'0 11px',border:'1px solid var(--ln2)',borderRadius:9,background:'var(--p2)',color:'var(--tx1)',fontFamily:'inherit',outline:'none'};
