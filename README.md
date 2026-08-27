MineTransformation
==================
一个仿 Desmos / GeoGebra 的函数画板：输入函数表达式、对函数施加变换并实时绘制。

功能
----
* 定义函数: `f(x)=x^2` / `f = x^2` / `fx=x^2` (省略括号), 支持带下标名称: `g2(x)`, `f_1(x)=x^2`, Unicode 下标 `g₂(x)=x²` 自动归一化
* 函数嵌套: `f_1(x)=2f(x)` 可以直接调用其他用户函数
* 仿射变换: `2f(x)` (纵伸缩) · `f(2x)` (横伸缩) · `f(x-1)+2` (平移) · `f(sin(x))` (复合)
* 矩阵变换: `M(0 1; 1 2)` 将矩阵作用于 (x, f(x)), 缺省作用于函数 f; 支持空格/逗号/分号分隔与负分量
* 无空格矩阵链: `Mf(x)` 即 `M f(x)`, 支持 `Af(x)` / `AAf(x)` / `M(0 1; 1 2)f(x)` 等紧贴写法
* 矩阵定义与运算: `A=M(0 1; 1 2)` 定义, `B=A*A` / `C=AA` / `D=A+A` 矩阵运算, `A f(x)` 或 `A f` 对函数施加矩阵
* 定义内施加矩阵: `g(x)=A f(x+2)` 或 `g(x)=Af(x)` (曲面定义, g 可再被 `A g` 引用)
* 矩阵链: `A A A A f(x)` 多层变换叠加 (从左到右为最外层)
* 纯数学绘图: `x^2` `sin(x)/x` `2x` 等直接作为 y=f(x) 绘图
* 数学运算: `+ - * / ^` 括号、隐式乘法(`2x`, `2(x+1)`, `(x+1)(x-1)`)、右结合幂 `2^3^2`
* 函数: `sin cos tan asin acos atan sinh cosh tanh sqrt cbrt abs ln log log2 exp floor ceil round sign`
* 常量: `pi` `e` `tau`; 全角字符/×÷−/上标自动归一化
* 常用记法: 隐式参数函数 `lnx`/`sinx`/`cos2x`/`sqrtx`（等价 `ln(x)` 等）、带底对数 `log2x`/`log_2(x)`/`log3x`、导数 `f'(x)`（用户函数数值导数）、`dy/dx`（隐式 f 的导数）
* 交互: 左键拖拽平移 · 滚轮缩放 · 工具栏缩放/重置 · 浮动的表达式面板(☰ 按钮折叠) · 点击列表项内联编辑(Enter 确定, Esc 取消) · ●/◌ 隐藏显示 · × 删除 · 悬停曲线浮动显示坐标 · 错误横幅不遮挡

开发
----
纯 HTML/CSS/JS, 无构建依赖。

    python serve.py              # 本地开发服务器, 入口 http://127.0.0.1:19696
    python serve.py 8000         # 指定其他端口
    node test/parser.test.js     # 表达式解析器测试
    node test/smoke.test.js      # 绘图集成冒烟测试

许可
----
MIT License, 详见 [LICENSE](LICENSE)。

目录
----
    index.html        页面入口
    css/style.css     界面样式
    js/parser.js      词法/语法/图元解析与编译
    js/plotter.js     Canvas 绘图(网格/坐标轴/曲线/视口)
    js/main.js        交互与 UI 逻辑
    serve.py          本地开发服务器 (默认端口 19696)
    LICENSE           MIT License
    test/             测试

矩阵说明
--------
M(a b; c d) 作用于 (t, f(t)): 点 (a*t + b*f(t), c*t + d*f(t)) 构成参数曲线, 支持

* `M(0 1; 1 2)`      仿射挤压
* `M(0 -1 1 0)`      旋转 90°
* `M(1 0 0 2)`       纵拉伸 2 倍
* `M(0 1; 1 2) 2f(x)` 对变换后函数再施加矩阵
* `A=M(0 1; 1 2)`    定义矩阵 A, 再用 `A f(x)` / `Af(x)` 施加
* `B=AA` (矩阵平方) 与 `B=A*A` 等价; `A A f(x)` 叠加两次
* `g(x)=A f(x+2)`    定义内直接施加矩阵 (结果为曲线, 可继续引用)
* 渲染说明: 参数曲线按视口四角经逆矩阵反推 t 范围采样; 函数/参数曲线共用统一自适应二分采样器(屏幕平坦度阈值 0.7px, 深度上限 12), 拖拽/缩放视口自动重采样
