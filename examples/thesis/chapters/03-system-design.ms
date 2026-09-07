import {Ref} from '@markscript/docx'
import {TableCaption} from '../components.tsx'
import DualPathDiagram from '../visuals/dual-path-diagram.ms'
import LayeredDiagram from '../visuals/layered-diagram.ms'
import MultiNodeDiagram from '../visuals/multi-node-diagram.ms'
import SingleNodeDiagram from '../visuals/single-node-diagram.ms'

# 第3章  需求分析与总体设计

## 3.1  系统需求分析

系统应当完成XXXX管理、XXXX处理、XXXX查询和XXXX输出等功能，并保证各功能之间的状态一致。

系统在性能、可靠性、可维护性和可扩展性方面应满足XXXX要求，关键处理过程应保留完整日志。

目标平台在XXXX资源、XXXX能力和XXXX环境方面存在约束，系统设计需要控制XXXX开销。实验环境覆盖XXXX场景和XXXX场景，测试结论限定在XXXX规模与XXXX条件内。

<TableCaption id="table-3-1">系统需求与验证关系</TableCaption>

| 需求类型 | 需求内容 | 验证方式 |
| :--- | :--- | :--- |
| 功能需求 | XXXX功能 | XXXX测试 |
| 性能需求 | XXXX指标 | XXXX测试 |
| 适配需求 | XXXX平台 | XXXX测试 |
| 可靠性需求 | XXXX恢复 | XXXX测试 |

<Ref target="table-3-1" />汇总了主要需求及其验证方式。

## 3.2  系统总体设计

系统遵循分层、解耦和状态可追踪原则，总体架构划分为六个层次。

<LayeredDiagram />

<Ref target="figure-3-1" />给出了系统分层架构。

控制面负责XXXX状态管理，数据面负责XXXX数据处理，两条路径最终汇总到XXXX节点。

<DualPathDiagram />

<Ref target="figure-3-2" />给出了双路径处理关系。

本地实验环境由三个节点组成，分别承担XXXX角色、XXXX角色和XXXX角色。

<MultiNodeDiagram />

物理验证环境由一台XXXX服务器和XXXX资源组成，主要用于XXXX验证。

<SingleNodeDiagram />

<Ref target="figure-3-3" />与<Ref target="figure-3-4" />分别给出了两种实验环境的结构。
