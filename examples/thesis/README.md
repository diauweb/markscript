# 学位论文DOCX模板

本示例是可复用的学位论文模板，同时也是MarkScript内容形式的紧凑目录。需要填写的内容使用与字段形式一致的遮盖文字：日期保留为“二零二X年六月”，学号保留为“2022XXXXXX”，正文保留学位论文的句式和章节层级。参考文献保留GB/T 7714中的作者、题名、文献类型、出版项和页码结构。

从仓库根目录运行：

~~~sh
bun run markscript run examples/thesis/index.ms > /dev/null
~~~

文档默认写入 `examples/thesis/thesis.docx`。可以通过环境变量覆盖输出位置：

~~~sh
MARKSCRIPT_THESIS_OUTPUT=/tmp/thesis.docx \
  bun run markscript run examples/thesis/index.ms > /dev/null
~~~

模板展示以下内容：

- 封面字段、位图标志、声明、中英文摘要、自动目录、参考文献、致谢和分节；
- 标题、段落、强调、加粗、删除、链接、行内代码、引用块、分隔线、有序列表、无序列表、嵌套列表、任务列表和代码块；
- Markdown表格、表题、单个与组合引文、图表交叉引用和未引用文献；
- DOCX段落与文字标注、空段落、空格、制表位、分页符和域；
- 导入位图、七种不同结构的Satori图和一种ECharts图。

`visuals/` 保留八种不同的图形结构，并统一使用中性文件名和组件名。图中文字保留层、组件、节点、路径、测试项和指标等原字段类型，具体名称使用 `XXXX`遮盖。

虚构的喵喵大学标志位于 `assets/cover.png`，尺寸为457 x 105像素，与封面图片槽完全一致。

图形默认读取WSL中可见的Times New Roman和宋体。字体位于其他位置时，可以显式设置：

~~~sh
MARKSCRIPT_THESIS_TIMES_FONT=/path/to/times.ttf \
MARKSCRIPT_THESIS_SIMSUN_FONT=/path/to/simsun.ttc \
MARKSCRIPT_THESIS_PYTHON=/path/to/python3 \
  bun run markscript run examples/thesis/index.ms > /dev/null
~~~

所有DOCX元数据都保存在普通MDAST上。`markscript run` 会在异步转换和图形渲染完成后，从 `onReady` 调用 `writeDocx`。
