import {FigureCaption} from '../components.tsx'
import {cm, type ThesisFigureSize} from './shared.tsx'

export const stagedFlowDiagramSize: ThesisFigureSize = {
  width: Math.round(cm(16)),
  height: 272,
}

::satori{{...stagedFlowDiagramSize} alt="XXXX接口组件处理流程"}
```satori
<div style={{display: 'flex', flexDirection: 'column', width: '100%', padding: 12, gap: 8, border: '1px solid #8b1e2d', background: '#ffffff', color: '#222222', fontFamily: 'Times New Roman, SimSun', fontSize: 16}}>
  <div style={{display: 'flex', height: 38, alignItems: 'center', justifyContent: 'center', background: '#8b1e2d', color: '#ffffff', fontSize: 18}}>XXXX接口组件处理流程</div>
  <div style={{display: 'flex', height: 44, alignItems: 'center', justifyContent: 'center', gap: 12}}><div style={{display: 'flex', width: 180, height: 40, alignItems: 'center', justifyContent: 'center', border: '1px solid #9f5963', background: '#f1dfe2'}}>XXXX控制器</div><div style={{display: 'flex', color: '#8b1e2d', fontSize: 20}}>→</div><div style={{display: 'flex', width: 180, height: 40, alignItems: 'center', justifyContent: 'center', border: '1px solid #9f5963', background: '#f7edef'}}>XXXX对象B</div></div>
  <div style={{display: 'flex', height: 18, alignItems: 'center', justifyContent: 'center', color: '#8b1e2d', fontSize: 20}}>↓</div>
  <div style={{display: 'flex', height: 44, gap: 10}}><div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX插件A</div><div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX插件B</div><div style={{display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px solid #999999', background: '#fafafa'}}>XXXX插件C</div></div>
  <div style={{display: 'flex', height: 18, alignItems: 'center', justifyContent: 'center', color: '#8b1e2d', fontSize: 20}}>↓</div>
  <div style={{display: 'flex', height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 100, marginRight: 100, border: '1px solid #8b1e2d', background: '#8b1e2d', color: '#ffffff'}}>XXXX目标资源</div>
</div>
```
<FigureCaption id="figure-4-1">XXXX接口组件处理流程</FigureCaption>
