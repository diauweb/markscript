import {PageBreak, Section, Span} from '@markscript/docx'
import {spacedText} from '../components.tsx'

<Section section="abstract" />

::docx{paragraph={{style: 'abstract-heading-zh'}}}

{spacedText('摘要')}

:::docx{paragraph={{style: 'abstract-body-zh'}}}

随着XXXX领域的持续发展，XXXX场景对XXXX能力提出了更高要求。针对现有XXXX方法在XXXX方面存在的问题，本文面向XXXX平台开展XXXX系统的设计与研究。

本文首先分析XXXX需求和XXXX约束，建立由XXXX层、XXXX层和XXXX层组成的总体架构；随后完成XXXX模块、XXXX模块和XXXX模块的设计与实现，并围绕XXXX流程形成完整的处理链路。

测试结果表明，所设计系统能够完成XXXX、XXXX和XXXX等功能，主要指标达到XXXX。相关研究验证了XXXX方法的可行性，并为XXXX场景下的后续研究提供参考。
:::

::docx{paragraph={{style: 'body-base', spacing: {line: 360, lineRule: 'exact'}, indent: {firstLine: 0}}}}

<p />

::docx{paragraph={{style: 'keyword-paragraph'}}}

<Span run={{style: 'keyword-label-zh'}}>关键词：</Span>XXXX；XXXX；XXXX；XXXX

<PageBreak />

::docx{paragraph={{style: 'abstract-heading-en'}}}

ABSTRACT

:::docx{paragraph={{style: 'abstract-body-en'}}}

With the continuing development of XXXX, the XXXX scenario requires improved XXXX capabilities. To address limitations of existing XXXX methods in XXXX, this thesis studies the design of an XXXX system for the XXXX platform.

The work analyzes XXXX requirements and XXXX constraints, establishes an architecture consisting of the XXXX layer, XXXX layer, and XXXX layer, and implements the XXXX, XXXX, and XXXX modules.

The results show that the system completes XXXX, XXXX, and XXXX, while the principal indicators reach XXXX. The study verifies the feasibility of XXXX and provides a reference for further work in XXXX.
:::

::docx{paragraph={{style: 'body-base', indent: {firstLine: 425}}}}

<p />

::docx{paragraph={{style: 'keyword-paragraph'}}}

<Span run={{style: 'keyword-label-en'}}>Key Words: </Span>XXXX; XXXX; XXXX; XXXX
