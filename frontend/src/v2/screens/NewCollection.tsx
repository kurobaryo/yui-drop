import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '@/lib/api';
import { createCollection, type CollectionVisibility } from '@/lib/api/collection';
import { pushRecent } from '@/lib/recent';
import { useCollectionMemberStore } from '@/stores/collectionMember';
import { toast } from '@/components/ui/Toast';
import { Icon } from '../components/IconSprite';

type Life = 1 | 7 | 30 | 365;

const GB = 1024 ** 3;
const MB = 1024 ** 2;
/** Labels match the prototype's select options; values go to the backend. */
const MAX_FILE = [
  { label: '500 MB', bytes: 500 * MB },
  { label: '2 GB', bytes: 2 * GB },
  { label: '10 GB', bytes: 10 * GB },
];
const CAPACITY = [
  { label: '10 GB', bytes: 10 * GB },
  { label: '50 GB', bytes: 50 * GB },
  { label: '不限', bytes: null as number | null },
];

function adminSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function NewCollection() {
  const navigate = useNavigate();
  const setMember = useCollectionMemberStore((s) => s.set);
  const [name, setName] = useState('');
  const [life, setLife] = useState<Life>(7);
  const [entryPassword, setEntryPassword] = useState('');
  const [maxFile, setMaxFile] = useState('2 GB');
  const [capacity, setCapacity] = useState('10 GB');
  const [showFiles, setShowFiles] = useState(true);
  const [allowMessages, setAllowMessages] = useState(true);
  const [notify, setNotify] = useState(false);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    const secret = adminSecret();
    try {
      const visibility: CollectionVisibility = showFiles ? 'public' : 'creator_only';
      const res = await createCollection({
        name: name.trim() || null,
        visibility,
        entry_password: entryPassword || null,
        admin_password: secret,
        lifetime_days: life,
        creator_nickname: 'Owner',
        max_file_bytes: MAX_FILE.find((x) => x.label === maxFile)?.bytes ?? null,
        capacity_bytes: CAPACITY.find((x) => x.label === capacity)?.bytes ?? null,
        allow_messages: allowMessages,
        notify_on_activity: notify,
      });
      if (res.member_token && res.member_id != null) {
        setMember(res.code, { memberToken: res.member_token, nickname: 'Owner', isCreator: true, adminPassword: secret });
      }
      pushRecent({ code: res.code, kind: 'collection', name: res.name, created_at: new Date().toISOString(), expires_at: res.expires_at, isCreator: true });
      navigate(`/c/${res.code}?created=1`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '创建失败，请稍后重试');
      setCreating(false);
    }
  };

  return (
    <div data-r="pad" style={{ maxWidth: 720, width: '100%', margin: '0 auto', padding: '32px 24px 40px', flex: 1 }}>
      <Back onClick={() => navigate('/')} />
      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--tx)' }}>新建收集箱</h1>
      <p style={{ fontSize: 14, color: 'var(--tx2)', marginTop: 8, maxWidth: 520 }}>创建后会得到一个 C + 5 位的编号，把编号发给大家，每个人都能往里丢文件。</p>

      <div style={{ marginTop: 24, border: '1px solid var(--ln)', borderRadius: 14, background: 'var(--pn)', overflow: 'hidden' }}>
        <Section><Field label="收集箱名称"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：市场部素材收集箱" style={input} /></Field></Section>
        <Divider />
        <Section>
          <div style={sectionLabel}>开放时长</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
            {([1,7,30,365] as Life[]).map((d) => <Choice key={d} active={life===d} onClick={() => setLife(d)}>{d===365?'1 年':`${d} 天`}</Choice>)}
          </div>
        </Section>
        <Divider />
        <div data-r="two-col" style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="单文件上限"><select value={maxFile} onChange={(e) => setMaxFile(e.target.value)} style={input}>{MAX_FILE.map((o) => <option key={o.label}>{o.label}</option>)}</select></Field>
          <Field label="收集箱容量"><select value={capacity} onChange={(e) => setCapacity(e.target.value)} style={input}>{CAPACITY.map((o) => <option key={o.label}>{o.label}</option>)}</select></Field>
        </div>
        <Divider />
        <div style={{ padding: '8px 20px 12px' }}>
          <Toggle label="投递后所有人可见" hint="关闭后只有创建者能查看文件" on={showFiles} set={setShowFiles} />
          <Toggle label="允许留言" hint="参与者可以在收集箱内交流" on={allowMessages} set={setAllowMessages} line />
          <Toggle label="收集更新通知" hint="这个浏览器里提示新文件和留言" on={notify} set={setNotify} line />
        </div>
        <Divider />
        <Section><Field label="进入密码（选填）"><input type="password" value={entryPassword} onChange={(e) => setEntryPassword(e.target.value)} placeholder="留空则有编号就能进" style={input} /></Field></Section>
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" data-yd="btn" onClick={() => void create()} disabled={creating} style={primary}>{creating?'创建中…':'创建收集箱'}<Icon name="i-arr" size={16} /></button>
        <button type="button" data-yd="quiet" onClick={() => navigate('/')} style={cancel}>取消</button>
      </div>
    </div>
  );
}

function Back({onClick}:{onClick:()=>void}) { return <button type="button" onClick={onClick} style={back}><Icon name="i-arr" size={14} style={{transform:'rotate(180deg)'}} />返回首页</button>; }
function Section({children}:{children:ReactNode}) { return <div style={{padding:'18px 20px'}}>{children}</div>; }
function Divider(){return <div style={{height:1,background:'var(--ln)'}}/>;}
function Field({label,children}:{label:string;children:ReactNode}){return <label style={{display:'flex',flexDirection:'column',gap:6,fontSize:12,color:'var(--tx3)'}}>{label}{children}</label>;}
function Choice({active,onClick,children}:{active:boolean;onClick:()=>void;children:ReactNode}){return <button type="button" onClick={onClick} style={{padding:'10px 6px',textAlign:'center',border:`1px solid ${active?'var(--ac)':'var(--ln)'}`,background:active?'var(--acs)':'transparent',color:active?'var(--act)':'var(--tx2)',borderRadius:9,fontSize:13,fontWeight:active?600:500,cursor:'pointer',fontFamily:'inherit'}}>{children}</button>;}
function Toggle({label,hint,on,set,line}:{label:string;hint:string;on:boolean;set:(x:boolean)=>void;line?:boolean}){return <button type="button" onClick={()=>set(!on)} style={{width:'100%',display:'flex',alignItems:'center',gap:12,padding:'11px 0',border:0,borderTop:line?'1px solid var(--ln)':'none',background:'transparent',cursor:'pointer',textAlign:'left',fontFamily:'inherit'}}><div style={{flex:1}}><div style={{fontSize:14,color:'var(--tx1)'}}>{label}</div><div style={{fontSize:12,color:'var(--tx3)'}}>{hint}</div></div><div style={{width:42,height:24,borderRadius:999,background:on?'var(--ac)':'var(--ln2)',position:'relative',flexShrink:0}}><div style={{position:'absolute',top:2,left:on?20:2,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left .16s'}}/></div></button>;}

const input:React.CSSProperties={height:42,padding:'0 12px',border:'1px solid var(--ln2)',borderRadius:10,background:'var(--p2)',color:'var(--tx1)',fontFamily:'inherit',fontSize:14,outline:'none',width:'100%'};
const sectionLabel:React.CSSProperties={fontSize:12,color:'var(--tx3)',marginBottom:10};
const back:React.CSSProperties={display:'inline-flex',alignItems:'center',gap:6,fontSize:13,color:'var(--tx2)',cursor:'pointer',marginBottom:18,border:0,background:'transparent',fontFamily:'inherit',padding:0};
const primary:React.CSSProperties={height:46,padding:'0 22px',border:0,borderRadius:10,background:'var(--ac)',color:'#fff',fontFamily:'inherit',fontSize:15,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8};
const cancel:React.CSSProperties={height:46,padding:'0 18px',border:'1px solid var(--ln2)',borderRadius:10,background:'transparent',color:'var(--tx2)',fontFamily:'inherit',fontSize:14,cursor:'pointer'};
