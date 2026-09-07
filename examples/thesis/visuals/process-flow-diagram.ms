import {FigureCaption} from '../components.tsx'
import {cm, type ThesisFigureSize} from './shared.tsx'

export const processFlowDiagramSize: ThesisFigureSize = {
  width: Math.round(cm(16)),
  height: 197,
}

::satori{{...processFlowDiagramSize} alt="XXXX处理流程"}
```satori
<div style={{display: 'flex', flexDirection: 'column', width: '100%', padding: 12, gap: 9, border: '1px solid #8b1e2d', background: '#ffffff', color: '#222222', fontFamily: 'Times New Roman, SimSun', fontSize: 16}}>
  <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', background: '#8b1e2d', color: '#ffffff', fontSize: 18}}>XXXX处理流程</div>
  <div style={{display: 'flex', height: 46, alignItems: 'center', justifyContent: 'center', gap: 10}}>
    <div style={{display: 'flex', width: 138, height: 42, alignItems: 'center', justifyContent: 'center', border: '1px solid #9f5963', background: '#f7edef'}}>XXXX状态</div>
    <div style={{display: 'flex', color: '#8b1e2d', fontSize: 20}}>→</div>
    <div style={{display: 'flex', width: 138, height: 42, alignItems: 'center', justifyContent: 'center', border: '1px solid #8b1e2d', background: '#f1dfe2'}}>XXXX处理器</div>
    <div style={{display: 'flex', color: '#8b1e2d', fontSize: 20}}>→</div>
    <div style={{display: 'flex', width: 138, height: 42, alignItems: 'center', justifyContent: 'center', border: '1px solid #9f5963', background: '#f7edef'}}>XXXX结果</div>
  </div>
  <div style={{display: 'flex', height: 18, alignItems: 'center', justifyContent: 'center', color: '#8b1e2d', fontSize: 20}}>↓</div>
  <div style={{display: 'flex', height: 42, gap: 10}}>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX观察A</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX观察B</div>
    <div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX观察C</div>
  </div>
</div>
```
<FigureCaption id="figure-2-2">XXXX处理流程</FigureCaption>
