import { Redirect, Route, Switch } from 'wouter'
import CharacterList from './pages/CharacterList.tsx'
import CharacterEdit from './pages/CharacterEdit.tsx'
import CharacterFiles from './pages/CharacterFiles.tsx'
import TextMatch from './pages/TextMatch.tsx'
import CatalogAdmin from './pages/CatalogAdmin.tsx'
import SceneList from './pages/SceneList.tsx'
import SceneEdit from './pages/SceneEdit.tsx'
import { editHref } from './api.ts'
import { PluginNav } from './components/PluginNav.tsx'

// 旧地址 /tagloom/<uuid>：那时人物都存成根目录下的 <uuid>.json
const OLD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function Routes() {
  // .app-theme：插件共用的颜色层级（见 src/client/app.css）
  return (
    <div className='tagloom-app app-theme'>
      <PluginNav />
      <Switch>
        <Route path='/' component={CharacterList} />
        <Route path='/files' component={CharacterFiles} />
        <Route path='/edit' component={CharacterEdit} />
        <Route path='/match' component={TextMatch} />
        <Route path='/catalog' component={CatalogAdmin} />
        <Route path='/scenes' component={SceneList} />
        <Route path='/scenes/edit' component={SceneEdit} />
        <Route path='/:id'>
          {(params) =>
            OLD_ID.test(params.id)
              ? <Redirect to={editHref(`${params.id}.json`)} replace />
              : '404 Not Found'}
        </Route>
        <Route>404 Not Found</Route>
      </Switch>
    </div>
  )
}
