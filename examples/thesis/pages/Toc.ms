import {PageBreak, Section, Toc} from '@markscript/docx'
import {spacedText} from '../components.tsx'

<PageBreak />

::docx{paragraph={{style: 'front-heading'}}}
{spacedText('目录')}

<Toc title="" hyperlink useAppliedParagraphOutlineLevel />

<Section section="body" />
