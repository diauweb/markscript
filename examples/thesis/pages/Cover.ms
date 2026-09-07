import {DocxImage, Span, Space} from '@markscript/docx'
import {CoverField} from '../components.tsx'
import cover from '../assets/cover.png'

::docx{paragraph={{style: 'body-base', spacing: {line: 1200, lineRule: 'exact'}, indent: {firstLine: 0}, alignment: 'center'}}}
<p />

::docx{paragraph={{alignment: 'center'}}}
<p>
  <DocxImage
    src={cover}
    alt="喵喵大学校名标志"
    image={{transformation: {width: 457, height: 105}}}
  />
</p>

::docx{paragraph={{style: 'cover-title', spacing: {before: 240, after: 480}}}}
毕业设计（论文）

::docx{paragraph={{style: 'cover-thesis', spacing: {after: 600}}}}

<p><Span run={{style: 'cover-thesis-run'}}>XXXXXXXXXXXXXXXXXXXX<Space /></Span></p>

<CoverField label="姓名" value="XXX" />

<CoverField label="学号" value="2022XXXXXX" />

<CoverField label="学院" value="XXXX学院" />

<CoverField label="专业班级" value="XXXX专业XXXX班" />

<CoverField label="指导教师" value="XXX" />

::docx{paragraph={{style: 'cover-date', spacing: {before: 2400}}}}

二零二X年六月
