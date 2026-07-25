import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { adminLogin, getAuthMethods } from '@/lib/api/admin';
import { ApiError } from '@/lib/api';
import { useAdminStore } from '@/stores/admin';
import { useThemeStore } from '@/stores/theme';
import { Icon, IconSprite } from '@/v2/components/IconSprite';
import '@/v2/styles/index.css';
import OidcLoginButton from './auth/OidcLoginButton';
import PasskeyLoginButton from './auth/PasskeyLoginButton';

export default function AdminLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setToken = useAdminStore((s) => s.set);
  const [searchParams, setSearchParams] = useSearchParams();
  const effective = useThemeStore((s) => s.effective());
  const setMode = useThemeStore((s) => s.setMode);
  const brand = useThemeStore((s) => s.brandName);
  const methodsQuery = useQuery({ queryKey: ['admin','auth','methods'], queryFn: getAuthMethods, refetchOnWindowFocus: true });
  const [password,setPassword]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{const reason=searchParams.get('oidc_error');if(!reason)return;setError(t(`admin.oidc.errors.${reason}`,{defaultValue:reason}));const next=new URLSearchParams(searchParams);next.delete('oidc_error');setSearchParams(next,{replace:true});},[searchParams,setSearchParams,t]);
  async function submit(e?:React.FormEvent){e?.preventDefault();if(submitting||!password)return;setSubmitting(true);setError(null);try{const res=await adminLogin(password);setToken(res.token,res.expires_at);navigate('/admin',{replace:true});}catch(err){setError(err instanceof ApiError?(err.message||t('admin.login.error')):t('admin.login.error'));}finally{setSubmitting(false);}}

  const methods=methodsQuery.data;
  const showPassword=methods?methods.password_enabled:true;
  const showPasskey=methods?.webauthn_enabled??false;
  const showOidc=methods?.oidc_enabled??false;

  return <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',background:'var(--bg)',color:'var(--tx1)',fontFamily:'var(--yd-font,system-ui,sans-serif)'}}>
    <IconSprite />
    <div data-r="pad" style={{display:'flex',alignItems:'center',gap:10,padding:'14px 24px',borderBottom:'1px solid var(--ln)'}}>
      <button type="button" onClick={()=>navigate('/')} style={brandButton}><div style={logo}><Icon name="i-logo" size={17} style={{color:'#fff'}}/></div><div style={{display:'flex',flexDirection:'column',textAlign:'left'}}><div style={{fontSize:14.5,fontWeight:700,letterSpacing:'-.02em',lineHeight:1.2,color:'var(--tx)'}}>{brand||'Yui Drop'}</div><div style={{fontSize:9.5,fontWeight:500,letterSpacing:'.16em',lineHeight:1.3,color:'var(--tx3)'}}>管理后台</div></div></button>
      <button type="button" data-yd="icon-btn" onClick={()=>setMode(effective==='dark'?'light':'dark')} style={iconButton}><Icon name={effective==='dark'?'i-moon':'i-sun'} size={15}/></button>
    </div>
    <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{width:360,maxWidth:'100%',background:'var(--pn)',border:'1px solid var(--ln)',borderRadius:14,padding:24,boxShadow:'var(--sh)'}}>
        <h1 style={{fontSize:20,fontWeight:700,color:'var(--tx)'}}>登录管理后台</h1>
        <p style={{fontSize:13,color:'var(--tx3)',marginTop:6}}>仅管理员可见。连续失败 10 次会被暂时锁定。</p>
        <div style={{marginTop:18,display:'flex',flexDirection:'column',gap:10}}>
          {showPasskey&&<PasskeyLoginButton onError={setError}/>} 
          {showPasskey&&showPassword&&<Divider/>}
          {showPassword&&<form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:10}}><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="管理员密码" autoFocus autoComplete="current-password" style={input}/><button type="submit" data-yd="btn" disabled={!password||submitting} style={{...loginButton,opacity:(!password||submitting)?.6:1}}>{submitting?'登录中…':'登录'}</button></form>}
          {showOidc&&<><Divider/><OidcLoginButton providerLabel={methods?.oidc_provider_label??''}/></>}
          {!showPassword&&!showPasskey&&!showOidc&&methods&&<p style={{fontSize:13,color:'var(--tx3)'}}>{t('admin.auth.allDisabled')}</p>}
        </div>
        {error&&<p role="alert" style={{marginTop:12,fontSize:13,color:'var(--bad)'}}>{error}</p>}
        <button type="button" onClick={()=>navigate('/')} style={back}>← 返回前台</button>
      </div>
    </div>
  </div>;
}
function Divider(){return <div style={{display:'flex',alignItems:'center',gap:10,color:'var(--tx3)',fontSize:12}}><span style={{flex:1,height:1,background:'var(--ln)'}}/>或<span style={{flex:1,height:1,background:'var(--ln)'}}/></div>;}
const brandButton:React.CSSProperties={display:'flex',alignItems:'center',gap:10,marginRight:'auto',cursor:'pointer',border:0,background:'transparent',padding:0,fontFamily:'inherit'};
const logo:React.CSSProperties={width:28,height:28,borderRadius:9,background:'var(--ac)',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 3px 10px var(--acs)',flexShrink:0};
const iconButton:React.CSSProperties={width:30,height:30,borderRadius:8,border:'1px solid var(--ln)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--act)',cursor:'pointer',background:'transparent'};
const input:React.CSSProperties={height:44,padding:'0 12px',border:'1px solid var(--ln2)',borderRadius:10,background:'var(--p2)',color:'var(--tx1)',fontFamily:'inherit',fontSize:14,outline:'none'};
const loginButton:React.CSSProperties={height:44,border:0,borderRadius:10,background:'var(--ac)',color:'#fff',fontFamily:'inherit',fontSize:15,fontWeight:600,cursor:'pointer'};
const back:React.CSSProperties={marginTop:16,fontSize:12,color:'var(--tx3)',cursor:'pointer',border:0,background:'transparent',fontFamily:'inherit',padding:0};
