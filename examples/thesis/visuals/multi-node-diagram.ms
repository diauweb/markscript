import {FigureCaption} from '../components.tsx'
import {cm, type ThesisFigureSize} from './shared.tsx'

export const multiNodeDiagramSize: ThesisFigureSize = {
  width: Math.round(cm(16)),
  height: 174,
}

::satori{{...multiNodeDiagramSize} alt="XXXX多节点实验环境"}
```satori
<div style={{display: 'flex', flexDirection: 'column', width: '100%', padding: 12, gap: 10, border: '1px solid #8b1e2d', background: '#ffffff', color: '#222222', fontFamily: 'Times New Roman, SimSun', fontSize: 16}}>
  <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', background: '#8b1e2d', color: '#ffffff', fontSize: 18}}>XXXX多节点实验环境</div>
  <div style={{display: 'flex', height: 100, gap: 12}}>
    <div style={{display: 'flex', flex: 1, flexDirection: 'column', border: '1px solid #9f5963'}}><div style={{display: 'flex', height: 42, alignItems: 'center', justifyContent: 'center', background: '#f1dfe2', color: '#6f1724'}}>XXXX节点A</div><div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', background: '#fafafa'}}>XXXX角色A</div></div>
    <div style={{display: 'flex', flex: 1, flexDirection: 'column', border: '1px solid #9f5963'}}><div style={{display: 'flex', height: 42, alignItems: 'center', justifyContent: 'center', background: '#f1dfe2', color: '#6f1724'}}>XXXX节点B</div><div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', background: '#fafafa'}}>XXXX角色B</div></div>
    <div style={{display: 'flex', flex: 1, flexDirection: 'column', border: '1px solid #9f5963'}}><div style={{display: 'flex', height: 42, alignItems: 'center', justifyContent: 'center', background: '#f1dfe2', color: '#6f1724'}}>XXXX节点C</div><div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', background: '#fafafa'}}>XXXX角色C</div></div>
  </div>
</div>
```
<FigureCaption id="figure-3-3">XXXX多节点实验环境</FigureCaption>
