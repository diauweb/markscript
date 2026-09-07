import {FigureCaption} from '../components.tsx'
import {cm, mm, type ThesisFigureSize} from './shared.tsx'

export const comparisonChartSize: ThesisFigureSize = {
  width: Math.round(cm(16)),
  height: Math.round(mm(80)),
}

export const comparisonChartOption = {
  animation: false,
  color: ['#8b1e2d', '#d6a1a8'],
  textStyle: {fontFamily: 'Times New Roman, SimSun', fontSize: 14},
  legend: {
    top: 0,
    right: 8,
    itemWidth: 14,
    itemHeight: 8,
    textStyle: {fontSize: 12},
  },
  grid: {left: 64, right: 24, top: 38, bottom: 48},
  xAxis: {
    type: 'category',
    data: ['测试项A', '测试项B', '测试项C', '测试项D'],
    axisLabel: {fontSize: 12},
  },
  yAxis: {
    type: 'value',
    name: 'XXXX指标',
    nameTextStyle: {fontSize: 11},
    axisLabel: {fontSize: 11},
    splitLine: {lineStyle: {color: '#dddddd'}},
  },
  series: [
    {name: '方案A', type: 'bar', barMaxWidth: 28, data: [12, 18, 15, 24]},
    {name: '方案B', type: 'bar', barMaxWidth: 28, data: [9, 14, 20, 19]},
  ],
}

::echarts{{...comparisonChartSize} alt="XXXX指标对比" option={comparisonChartOption}}
```echarts
{}
```
<FigureCaption id="figure-5-1">XXXX指标对比</FigureCaption>
