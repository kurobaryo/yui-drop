import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/IconSprite';
import { useTranslation } from 'react-i18next';

const ENDPOINTS = [
  { method: 'POST', path: '/api/v1/upload', descKey: 'v2.docs.upload', color: '#178a5a' },
  { method: 'POST', path: '/api/v1/upload/init', descKey: 'v2.docs.initUpload', color: '#178a5a' },
  { method: 'POST', path: '/api/v1/upload/{id}/sign-part', descKey: 'v2.docs.signPart', color: '#178a5a' },
  { method: 'POST', path: '/api/v1/upload/{id}/complete', descKey: 'v2.docs.completeUpload', color: '#178a5a' },
  { method: 'GET', path: '/api/v1/shares/{code}', descKey: 'v2.docs.readShare', color: '#3f7bb3' },
  { method: 'DELETE', path: '/api/v1/upload/{id}', descKey: 'v2.docs.cancelUpload', color: '#c2402f' },
];

const CURL = `curl -X POST https://drop.example.com/api/v1/upload \\
  -H "Authorization: Bearer ***" \\
  -F "file=@./screenshot.png" \\
  -F "expire_value=7" -F "expire_style=day"`;

export function DocsV2() {
  const { t } = useTranslation();
  const navigate=useNavigate();
  return <div data-r="pad" style={{maxWidth:920,width:'100%',margin:'0 auto',padding:'32px 24px 40px',flex:1}}>
    <button type="button" onClick={()=>navigate('/')} style={back}><Icon name="i-arr" size={14} style={{transform:'rotate(180deg)'}}/>{t('v2.docs.back')}</button>
    <h1 style={{fontSize:32,fontWeight:700,letterSpacing:'-.02em',color:'var(--tx)'}}>{t('v2.docs.title')}</h1>
    <p style={{fontSize:15,color:'var(--tx2)',marginTop:8,maxWidth:560}}><code>/api/v1/*</code> 是稳定的公开接口，用后台签发的 Bearer key 鉴权，按 key 绑定 upload / read 权限与配额。</p>
    <div style={{marginTop:24,display:'flex',flexDirection:'column',gap:10}}>
      {ENDPOINTS.map(e=><div key={e.method+e.path} style={{border:'1px solid var(--ln)',borderRadius:12,background:'var(--pn)',padding:'14px 16px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:700,color:'#fff',background:e.color,padding:'3px 8px',borderRadius:6}}>{e.method}</span>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:'var(--tx1)'}}>{e.path}</span>
        <span style={{fontSize:13,color:'var(--tx3)',marginLeft:'auto'}}>{t(e.descKey)}</span>
      </div>)}
    </div>
    <div style={{marginTop:24,border:'1px solid var(--ln)',borderRadius:12,overflow:'hidden',background:'var(--p2)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 14px',borderBottom:'1px solid var(--ln)',fontSize:12,color:'var(--tx3)'}}><span style={{marginRight:'auto'}}>简单上传 · curl</span><button type="button" data-yd="quiet" onClick={()=>void navigator.clipboard?.writeText(CURL)} style={copy}><Icon name="i-copy" size={13}/>复制</button></div>
      <pre style={{margin:0,padding:14,fontFamily:"'JetBrains Mono',monospace",fontSize:12.5,lineHeight:1.7,color:'var(--tx1)',overflowX:'auto'}}>{CURL}</pre>
    </div>
  </div>;
}
const back:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,fontSize:13,color:'var(--tx2)',cursor:'pointer',marginBottom:18,border:0,background:'transparent',fontFamily:'inherit',padding:0};
const copy:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:5,cursor:'pointer',border:0,background:'transparent',color:'inherit',fontFamily:'inherit'};
