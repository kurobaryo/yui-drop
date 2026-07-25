import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { getDashboard, listLogs } from '@/lib/api/admin';
import { humanBytes, humanDuration } from '@/lib/format';
import { Icon } from '@/v2/components/IconSprite';
import { Spinner } from '@/components/ui/Spinner';

export default function Dashboard() {
  const navigate=useNavigate();
  const q=useQuery({queryKey:['admin','dashboard'],queryFn:getDashboard,refetchInterval:30_000});
  const logs=useQuery({queryKey:['admin','logs','dashboard'],queryFn:()=>listLogs({page:1,size:4}),refetchInterval:30_000});
  if(q.isLoading)return <div style={{minHeight:'40vh',display:'flex',alignItems:'center',justifyContent:'center'}}><Spinner/></div>;
  if(q.error||!q.data)return <p style={{fontSize:13,color:'var(--bad)'}}>{(q.error as Error)?.message??'—'}</p>;
  const d=q.data;
  const cards=[
    {label:'分享总数',value:String(d.totalFiles),icon:'i-file'},
    {label:'已用存储',value:humanBytes(d.storageUsed),icon:'i-hdd'},
    {label:'回收站',value:String(d.recycledFiles),icon:'i-trash'},
    {label:'运行时长',value:humanDuration(d.sysUptime),icon:'i-clock'},
  ];
  return <div>
    <h1 style={title}>仪表盘</h1>
    <div data-r="stats" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
      {cards.map(c=><div key={c.label} style={card}><div style={label}><Icon name={c.icon} size={13}/>{c.label}</div><div style={big}>{c.value}</div></div>)}
    </div>
    <div data-r="two-col" style={{marginTop:12,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
      <CounterCard label="今天" uploads={d.today.uploads} retrievals={d.today.retrievals}/>
      <CounterCard label="昨天" uploads={d.yesterday.uploads} retrievals={d.yesterday.retrievals}/>
    </div>
    <div style={{...card,marginTop:12,padding:16}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}><div style={{fontSize:13,fontWeight:600,color:'var(--tx)',marginRight:'auto'}}>最近事件</div><button type="button" onClick={()=>navigate('/admin/logs')} style={link}>查看全部日志</button></div>
      {(logs.data?.items??[]).map((e,i)=><div key={e.id} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0',borderTop:i?'1px solid var(--ln)':'none',fontSize:13}}>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:'var(--tx3)',flexShrink:0}}>{e.ts?new Date(e.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'—'}</span>
        <span style={{fontSize:11,padding:'2px 7px',borderRadius:5,background:e.status_code&&e.status_code>=400?'color-mix(in srgb,var(--bad) 14%,transparent)':'var(--acs)',color:e.status_code&&e.status_code>=400?'var(--bad)':'var(--act)',flexShrink:0}}>{e.action}</span>
        <span style={{flex:1,minWidth:0,color:'var(--tx1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.code||String(e.extra?.message??'系统事件')}</span>
        <span data-r="rowmeta" style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:'var(--tx3)'}}>{e.ip||'—'}</span>
      </div>)}
      {!logs.isLoading&&!logs.data?.items.length&&<div style={{fontSize:12,color:'var(--tx3)'}}>暂无事件</div>}
    </div>
  </div>;
}
function CounterCard({label:cap,uploads,retrievals}:{label:string;uploads:number;retrievals:number}){return <div style={{...card,padding:16}}><div style={{fontSize:12,color:'var(--tx3)'}}>{cap}</div><div style={{marginTop:10,display:'flex',gap:32}}><Metric label="上传" value={uploads}/><Metric label="取件" value={retrievals}/><Metric label="失败取件" value="—" warn/></div></div>;}
function Metric({label:cap,value,warn}:{label:string;value:number|string;warn?:boolean}){return <div><div style={{fontSize:12,color:'var(--tx3)'}}>{cap}</div><div style={{fontSize:22,fontWeight:700,color:warn?'var(--warn)':'var(--tx)',fontFamily:"'JetBrains Mono',monospace"}}>{value}</div></div>;}
const title:React.CSSProperties={fontSize:22,fontWeight:700,letterSpacing:'-.01em',color:'var(--tx)',marginBottom:16};
const card:React.CSSProperties={border:'1px solid var(--ln)',borderRadius:12,background:'var(--pn)',padding:14};
const label:React.CSSProperties={display:'flex',alignItems:'center',gap:7,fontSize:12,color:'var(--tx3)'};
const big:React.CSSProperties={marginTop:8,fontSize:26,fontWeight:700,color:'var(--tx)',fontFamily:"'JetBrains Mono',monospace"};
const link:React.CSSProperties={fontSize:12,color:'var(--act)',cursor:'pointer',border:0,background:'transparent',fontFamily:'inherit'};
