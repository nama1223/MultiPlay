import { useState } from 'react'
import { SongListPage } from './components/SongListPage'
import { PlayerPage } from './components/PlayerPage'
import { AdminPage } from './components/AdminPage'
import './App.css'
import './multiplay.css'

type Route = { name: 'list' } | { name: 'player'; songId: string } | { name: 'admin' }

function StudioLinks() {
  return (
    <div style={{ width: '95%', maxWidth: 450, margin: '2.2em auto 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8 }}>
        <a href="/" target="_blank" rel="noopener" style={{ display: 'flex', alignItems: 'center', opacity: 0.85, marginRight: 14 }}>
          <img src="/NamaStudioLogoHalf.png" alt="Nama Studio" style={{ height: 35, width: 'auto', display: 'block' }} />
        </a>
        <a href="https://www.amazon.jp/hz/wishlist/ls/21PS61YG1P32B?ref_=wl_share" target="_blank" rel="noreferrer noopener" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', opacity: 0.75 }}>
          <span style={{ display: 'inline-block', width: 85, height: 35, backgroundImage: "url('https://m.media-amazon.com/images/G/09/gno/sprites/nav-sprite-global-1x-reorg-privacy._CB546377955_.png')", backgroundPosition: '-5px -85px', backgroundRepeat: 'no-repeat', backgroundSize: 'auto', flexShrink: 0, backgroundColor: '#000' }} />
        </a>
        <span style={{ fontSize: '0.8rem', fontWeight: 'bold', opacity: 0.75 }}>ほしいものリスト</span>
      </div>
      <div style={{ fontSize: '0.72rem', opacity: 0.65, marginTop: 4 }}>
        （nama1223.com が使えない時は <a href="https://nama1223.github.io/" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>https://nama1223.github.io</a> でも開けます）
      </div>
    </div>
  )
}

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'list' })

  return (
    <div className="mp-app">
      <header className="mp-header">
        <span className="mp-logo">MultiPlay</span>
        <button className="mp-admin-link" onClick={() => setRoute({ name: 'admin' })}>管理</button>
      </header>
      <main className="mp-main">
        {route.name === 'list' && (
          <>
            <SongListPage onSelect={songId => setRoute({ name: 'player', songId })} />
            <StudioLinks />
          </>
        )}
        {route.name === 'player' && (
          <PlayerPage songId={route.songId} onBack={() => setRoute({ name: 'list' })} />
        )}
        {route.name === 'admin' && (
          <AdminPage onBack={() => setRoute({ name: 'list' })} />
        )}
      </main>
    </div>
  )
}
