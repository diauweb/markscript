import {FigureCaption} from '../components.tsx'
import {cm, type ThesisFigureSize} from './shared.tsx'

export const layeredDiagramSize: ThesisFigureSize = {
  width: Math.round(cm(16)),
  height: 322,
}

::satori{{...layeredDiagramSize} alt="XXXX系统分层架构"}
```satori
<div style={{display: 'flex', flexDirection: 'column', width: '100%', padding: 12, gap: 7, border: '1px solid #8b1e2d', background: '#ffffff', color: '#222222', fontFamily: 'Times New Roman, SimSun', fontSize: 16}}>
  <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', background: '#8b1e2d', color: '#ffffff', fontSize: 18}}>XXXX系统分层架构</div>
  <div style={{display: 'flex', height: 36, alignItems: 'center', justifyContent: 'center', border: '1px solid #9f5963', background: '#f1dfe2'}}>XXXX层一</div>
  <div style={{display: 'flex', height: 36, alignItems: 'center', justifyContent: 'center', border: '1px solid #aa6b74', background: '#f5e7e9'}}>XXXX层二</div>
  <div style={{display: 'flex', height: 36, alignItems: 'center', justifyContent: 'center', border: '1px solid #b77e86', background: '#f8eff0'}}>XXXX层三</div>
  <div style={{display: 'flex', height: 36, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#f5f5f5'}}>XXXX层四</div>
  <div style={{display: 'flex', height: 36, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX层五</div>
  <div style={{display: 'flex', height: 36, alignItems: 'center', justifyContent: 'center', border: '1px solid #888888', background: '#ffffff'}}>XXXX层六</div>
</div>
```
<FigureCaption id="figure-3-1">XXXX系统分层架构</FigureCaption>
