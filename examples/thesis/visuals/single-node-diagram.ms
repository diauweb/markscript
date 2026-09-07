import {FigureCaption} from '../components.tsx'
import {cm, type ThesisFigureSize} from './shared.tsx'

export const singleNodeDiagramSize: ThesisFigureSize = {
  width: Math.round(cm(16)),
  height: 176,
}

::satori{{...singleNodeDiagramSize} alt="XXXX单节点验证环境"}
```satori
<div style={{display: 'flex', flexDirection: 'column', width: '100%', padding: 12, gap: 10, border: '1px solid #8b1e2d', background: '#ffffff', color: '#222222', fontFamily: 'Times New Roman, SimSun', fontSize: 16}}>
  <div style={{display: 'flex', height: 34, alignItems: 'center', justifyContent: 'center', color: '#6f1724', fontSize: 18}}>XXXX单节点验证环境</div>
  <div style={{display: 'flex', height: 48, alignItems: 'center', justifyContent: 'center', background: '#8b1e2d', color: '#ffffff', fontSize: 18}}>XXXX平台</div>
  <div style={{display: 'flex', height: 48, gap: 8}}>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX资源A</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX资源B</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX资源C</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX资源D</div>
  </div>
</div>
```
<FigureCaption id="figure-3-4">XXXX单节点验证环境</FigureCaption>
