import {FigureCaption} from '../components.tsx'
import {cm, type ThesisFigureSize} from './shared.tsx'

export const dualPathDiagramSize: ThesisFigureSize = {
  width: Math.round(cm(16)),
  height: 296,
}

::satori{{...dualPathDiagramSize} alt="XXXX双路径处理流程"}
```satori
<div style={{display: 'flex', flexDirection: 'column', width: '100%', padding: 12, gap: 8, border: '1px solid #8b1e2d', background: '#ffffff', color: '#222222', fontFamily: 'Times New Roman, SimSun', fontSize: 16}}>
  <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', background: '#8b1e2d', color: '#ffffff', fontSize: 18}}>XXXX双路径处理流程</div>
  <div style={{display: 'flex', height: 146, gap: 24}}>
    <div style={{display: 'flex', flex: 1, flexDirection: 'column', padding: 8, gap: 7, border: '1px solid #b77982', background: '#fbf5f6'}}>
      <div style={{display: 'flex', height: 28, alignItems: 'center', justifyContent: 'center', color: '#6f1724'}}>路径A</div>
      <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', border: '1px solid #9f5963', background: '#f1dfe2'}}>XXXX步骤A1</div>
      <div style={{display: 'flex', height: 12, alignItems: 'center', justifyContent: 'center', color: '#8b1e2d'}}>↓</div>
      <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', border: '1px solid #9f5963', background: '#f7edef'}}>XXXX步骤A2</div>
    </div>
    <div style={{display: 'flex', flex: 1, flexDirection: 'column', padding: 8, gap: 7, border: '1px solid #999999', background: '#fafafa'}}>
      <div style={{display: 'flex', height: 28, alignItems: 'center', justifyContent: 'center', color: '#444444'}}>路径B</div>
      <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', border: '1px solid #888888', background: '#eeeeee'}}>XXXX步骤B1</div>
      <div style={{display: 'flex', height: 12, alignItems: 'center', justifyContent: 'center', color: '#666666'}}>↓</div>
      <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', border: '1px solid #888888', background: '#f5f5f5'}}>XXXX步骤B2</div>
    </div>
  </div>
  <div style={{display: 'flex', height: 18, alignItems: 'center', justifyContent: 'center', color: '#8b1e2d', fontSize: 20}}>↓</div>
  <div style={{display: 'flex', height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 120, marginRight: 120, border: '1px solid #8b1e2d', background: '#8b1e2d', color: '#ffffff'}}>XXXX汇合节点</div>
</div>
```
<FigureCaption id="figure-3-2">XXXX双路径处理流程</FigureCaption>
