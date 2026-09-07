import {Section, Space} from '@markscript/docx'
import {Underlined} from '../components.tsx'

<Section section="declaration" />

::docx{paragraph={{style: 'declaration-heading'}}}

学位论文原创性声明

:::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 600}, alignment: 'left'}}}

<p />

<p />
:::

:::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 480}, alignment: 'left'}}}

本人所提交的学位论文<Underlined>XXXXXXXXXXXXX</Underlined>，是在导师的指导下，独立进行研究工作所取得的原创性成果。除文中已经注明引用的内容外，本论文不包含任何其他个人或集体已经发表或撰写过的研究成果。对本文的研究做出重要贡献的个人和集体，均已在文中标明。

本声明的法律后果由本人承担。

<p />

<p />
:::

::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 1200}, alignment: 'left'}}}

论文作者（签名）：<Space count={36} />指导教师确认（签名）：

::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 2640}, alignment: 'left'}}}

年    月    日<Space count={36} />年    月    日

:::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 1200}, alignment: 'left'}}}

<p />

<p />
:::

::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 1200}, alignment: 'center'}}}

<p />

::docx{paragraph={{style: 'declaration-heading'}}}

学位论文版权使用授权书

::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 600}}}}

<p />

:::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 480}}}}

本学位论文作者完全了解喵喵大学有权保留并向国家有关部门或机构送交学位论文的复印件和磁盘，允许论文被查阅和借阅。本人授权喵喵大学可以将学位论文的全部或部分内容编入有关数据库进行检索，可以采用影印、缩印或其它复制手段保存、汇编学位论文。

保密的学位论文在_______年解密后适用本授权书。

<p />

<p />
:::

::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 1200}}}}

论文作者（签名）：<Space count={36} />指导教师（签名）：

:::docx{paragraph={{style: 'declaration-body', indent: {firstLine: 2640}}}}

年     月     日<Space count={36} />年     月      日

<p />
:::
