import {FigureCaption} from '../components.tsx'
import {cm, type ThesisFigureSize} from './shared.tsx'

export const relationshipDiagramSize: ThesisFigureSize = {
  width: Math.round(cm(16)),
  height: 261,
}

::satori{{...relationshipDiagramSize} alt="XXXX技术链条"}
```satori
<div style={{display: 'flex', flexDirection: 'column', width: '100%', padding: 12, gap: 7, border: '1px solid #8b1e2d', background: '#ffffff', color: '#222222', fontFamily: 'Times New Roman, SimSun', fontSize: 16}}>
  <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', background: '#8b1e2d', color: '#ffffff', fontSize: 18}}>XXXX技术链条</div>
  <div style={{display: 'flex', height: 42, gap: 8}}>
    <div style={{display: 'flex', width: 88, alignItems: 'center', justifyContent: 'center', background: '#f1dfe2', color: '#6f1724', border: '1px solid #c47b86'}}>XXXX层</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX组件A</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX组件B</div>
  </div>
  <div style={{display: 'flex', height: 18, alignItems: 'center', justifyContent: 'center', color: '#8b1e2d', fontSize: 20}}>↓</div>
  <div style={{display: 'flex', height: 42, gap: 8}}>
    <div style={{display: 'flex', width: 88, alignItems: 'center', justifyContent: 'center', background: '#f1dfe2', color: '#6f1724', border: '1px solid #c47b86'}}>XXXX层</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX组件C</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX组件D</div>
  </div>
  <div style={{display: 'flex', height: 18, alignItems: 'center', justifyContent: 'center', color: '#8b1e2d', fontSize: 20}}>↓</div>
  <div style={{display: 'flex', height: 42, gap: 8}}>
    <div style={{display: 'flex', width: 88, alignItems: 'center', justifyContent: 'center', background: '#f1dfe2', color: '#6f1724', border: '1px solid #c47b86'}}>XXXX层</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX环境A</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX环境B</div>
  </div>
</div>
```
<FigureCaption id="figure-2-1">XXXX技术链条</FigureCaption>
