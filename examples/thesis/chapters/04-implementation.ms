import {DocxImage, PageBreak, Ref, Space} from '@markscript/docx'
import {TableCaption} from '../components.tsx'
import cover from '../assets/cover.png'
import StagedFlowDiagram from '../visuals/staged-flow-diagram.ms'

# 第4章  关键组件与系统实现

## 4.1  运行环境与构建

运行环境采用XXXX操作系统，配置XXXX、XXXX和XXXX等基础依赖。运行时设置XXXX参数、XXXX目录和XXXX服务，并通过XXXX命令确认运行状态。

~~~bash
xxxx --config XXXX --output XXXX
~~~

集群由XXXX节点、XXXX节点和XXXX节点构成，节点之间通过XXXX网络连接。多架构环境面向XXXX和XXXX目标，使用统一构建参数生成对应产物。

<TableCaption id="table-4-1">主要组件构建信息</TableCaption>

| 组件 | 版本 | 构建方式 | 输出形式 |
| :--- | :---: | :--- | :--- |
| XXXX组件A | vX.X.X | XXXX构建 | XXXX文件 |
| XXXX组件B | vX.X.X | XXXX构建 | XXXX镜像 |
| XXXX组件C | vX.X.X | XXXX构建 | XXXX软件包 |

## 4.2  关键组件与系统实现

核心组件包含XXXX模块、XXXX模块和XXXX模块，各模块按照XXXX接口组织。编排组件负责XXXX资源创建、XXXX状态同步和XXXX异常恢复。

::docx{paragraph={{alignment: 'center'}}}

<p>
  <DocxImage
    src={cover}
    alt="喵喵大学校名标志"
    image={{transformation: {width: 305, height: 70}}}
  />
</p>

资源文件按照“名称<Space count={8} />版本”的形式记录，并与构建产物一同封装。

<StagedFlowDiagram />

<Ref target="figure-4-1" />给出了接口组件的阶段处理流程。接入过程依次完成XXXX配置、XXXX启动和XXXX状态确认。

<PageBreak label="第4章分页" />

系统在全部处理任务完成后生成最终文档，目录、题注、交叉引用和页码均基于最终结构形成。
