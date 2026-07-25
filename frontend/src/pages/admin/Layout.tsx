/**
 * Admin v2 shell — guard + prototype-accurate header/sidebar/mobile nav.
 *
 * Existing admin page components remain the Outlet children, so all current
 * APIs/actions keep working while each screen is restyled incrementally.
 */
import { useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAdminStore } from '@/stores/admin';
import { useThemeStore } from '@/stores/theme';
import { Icon, IconSprite } from '@/v2/components/IconSprite';
import '@/v2/styles/index.css';

const NAV = [
  { to: '/admin', end: true, label: '仪表盘', icon: 'i-dash' },
  { to: '/admin/files', end: false, label: '文件', icon: 'i-file' },
  { to: '/admin/collections', end: false, label: '收集箱', icon: 'i-inbox' },
  { to: '/admin/api-keys', end: false, label: 'API Keys', icon: 'i-key' },
  { to: '/admin/logs', end: false, label: '访问日志', icon: 'i-log' },
  { to: '/admin/theme', end: false, label: '主题', icon: 'i-theme' },
  { to: '/admin/settings', end: false, label: '设置', icon: 'i-gear' },
] as const;

const MOBILE_PRIMARY = NAV.slice(0, 3);
const MOBILE_MORE = NAV.slice(3);

export default function AdminLayout() {
  const navigate = useNavigate();
  const valid = useAdminStore((s) => s.isValid());
  const clear = useAdminStore((s) => s.clear);
  const setMode = useThemeStore((s) => s.setMode);
  const effective = useThemeStore((s) => s.effective());
  const brand = useThemeStore((s) => s.brandName);
  const [moreOpen, setMoreOpen] = useState(false);

  if (!valid) return <Navigate to="/admin/login" replace />;
  const logout = () => { clear(); navigate('/admin/login', { replace: true }); };
  const toggleMode = () => setMode(effective === 'dark' ? 'light' : 'dark');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--tx1)', fontFamily: 'var(--yd-font, system-ui,sans-serif)' }}>
      <IconSprite />
      <div data-r="pad" style={header}>
        <button type="button" onClick={() => navigate('/')} style={brandButton}>
          <div style={logo}><Icon name="i-logo" size={17} style={{ color: '#fff' }} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2, color: 'var(--tx)' }}>{brand || 'Yui Drop'}</div>
            <div style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: '.16em', lineHeight: 1.3, color: 'var(--tx3)' }}>管理后台</div>
          </div>
        </button>
        <span data-r="hide-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx3)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ok)' }} />存储 · 已连接</span>
        <button type="button" data-yd="icon-btn" onClick={toggleMode} title="切换亮暗" style={iconButton}><Icon name={effective === 'dark' ? 'i-moon' : 'i-sun'} size={15} /></button>
        <button type="button" data-yd="icon-btn" onClick={logout} title="退出登录" style={iconButton}><Icon name="i-out" size={15} /></button>
      </div>

      <div data-r="pad" style={{ flex: 1, maxWidth: 1180, width: '100%', margin: '0 auto', padding: '20px 24px', display: 'flex', gap: 24 }}>
        <aside data-r="sidebar" style={sidebar}>
          {NAV.map((n) => <AdminNav key={n.to} {...n} />)}
          <button type="button" onClick={logout} style={{ ...navBase, marginTop: 10, color: 'var(--tx3)', border: 0, background: 'transparent', width: '100%' }}><Icon name="i-out" size={16} />退出登录</button>
        </aside>
        <main data-r="adminmain" style={{ flex: 1, minWidth: 0 }}><Outlet /></main>
      </div>

      {/* Mobile: dashboard / files / collections / more, exactly as prototype. */}
      <nav data-r="mobnav" style={mobileNav}>
        {MOBILE_PRIMARY.map((n) => <MobileNav key={n.to} {...n} />)}
        <button type="button" onClick={() => setMoreOpen(true)} style={mobileButton}><Icon name="i-more" size={19} /><span>更多</span></button>
      </nav>

      {moreOpen && <div data-yd="backdrop" data-r="backdrop" onClick={() => setMoreOpen(false)} style={backdrop}>
        <div data-yd="sheetup" data-r="sheet" onClick={(e) => e.stopPropagation()} style={sheet}>
          <div data-r="grabber" style={{ width: 42, height: 5, borderRadius: 999, background: 'var(--grab)', margin: '10px auto 12px' }} />
          <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
            {MOBILE_MORE.map((n) => <NavLink key={n.to} to={n.to} onClick={() => setMoreOpen(false)} style={sheetItem}><Icon name={n.icon} size={18} />{n.label}</NavLink>)}
            <button type="button" onClick={logout} style={{ ...sheetItem, color: 'var(--bad)', fontFamily: 'inherit' }}><Icon name="i-out" size={18} />退出登录</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

function AdminNav({to,end,label,icon}:{to:string;end:boolean;label:string;icon:string}) {
  return <NavLink to={to} end={end} style={({isActive}) => ({ ...navBase, background: isActive ? 'var(--acs)' : 'transparent', color: isActive ? 'var(--act)' : 'var(--tx2)', fontWeight: isActive ? 600 : 500 })}><Icon name={icon} size={16}/>{label}</NavLink>;
}
function MobileNav({to,end,label,icon}:{to:string;end:boolean;label:string;icon:string}) {
  return <NavLink to={to} end={end} style={({isActive}) => ({ ...mobileButton, color: isActive ? 'var(--act)' : 'var(--tx3)' })}><Icon name={icon} size={19}/><span>{label}</span></NavLink>;
}

const header:React.CSSProperties={display:'flex',alignItems:'center',gap:12,padding:'12px 24px',borderBottom:'1px solid var(--ln)',position:'sticky',top:0,background:'color-mix(in srgb,var(--bg) 76%,transparent)',backdropFilter:'saturate(170%) blur(14px)',WebkitBackdropFilter:'saturate(170%) blur(14px)',zIndex:40};
const brandButton:React.CSSProperties={display:'flex',alignItems:'center',gap:10,marginRight:'auto',cursor:'pointer',border:0,background:'transparent',padding:0,fontFamily:'inherit'};
const logo:React.CSSProperties={width:28,height:28,borderRadius:9,background:'var(--ac)',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 3px 10px var(--acs)',flexShrink:0};
const iconButton:React.CSSProperties={width:30,height:30,borderRadius:8,border:'1px solid var(--ln)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--act)',cursor:'pointer',background:'transparent'};
const sidebar:React.CSSProperties={width:186,flexShrink:0,alignSelf:'flex-start',position:'sticky',top:76,maxHeight:'calc(100vh - 96px)',overflowY:'auto',display:'flex',flexDirection:'column',gap:2};
const navBase:React.CSSProperties={display:'flex',alignItems:'center',gap:9,padding:'8px 11px',borderRadius:9,fontSize:13.5,cursor:'pointer',textDecoration:'none',transition:'.14s',fontFamily:'inherit',textAlign:'left'};
const mobileNav:React.CSSProperties={display:'none',position:'fixed',left:0,right:0,bottom:0,zIndex:45,gridTemplateColumns:'repeat(4,1fr)',borderTop:'1px solid var(--ln)',background:'color-mix(in srgb,var(--pn) 90%,transparent)',backdropFilter:'blur(16px)',padding:'6px 8px calc(6px + env(safe-area-inset-bottom))'};
const mobileButton:React.CSSProperties={border:0,background:'transparent',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2,minHeight:48,fontSize:10,color:'var(--tx3)',textDecoration:'none',cursor:'pointer'};
const backdrop:React.CSSProperties={position:'fixed',inset:0,zIndex:80,background:'rgba(4,6,10,.55)',display:'flex',alignItems:'flex-end',justifyContent:'center'};
const sheet:React.CSSProperties={width:'100%',maxWidth:520,borderRadius:'20px 20px 0 0',background:'var(--pn)',border:'1px solid var(--ln)',boxShadow:'var(--shl)'};
const sheetItem:React.CSSProperties={minHeight:52,border:'1px solid var(--ln)',borderRadius:10,background:'var(--p1)',color:'var(--tx2)',display:'flex',alignItems:'center',gap:9,padding:'0 12px',textDecoration:'none',fontSize:13};
