MineTransformation
==================
一个仿 Desmos / GeoGebra 的函数画板：输入函数表达式、对函数施加变换并实时绘制。

用法
----
* 定义函数：  `f(x)=x^2`  或  `f = x^2`
* 变换（对 f 施加）：`2f(x)` 纵伸缩；`f(2x)` 横伸缩；`f(x)+3` 平移
* 矩阵变换： `M(0 1; 1 2)` 作用于 (x, f(x)) 生成的曲线
* 支持：+ - * / ^ sqrt sin cos tan asin acos atan log ln exp abs floor ceil pi e

开发
----
纯 HTML/CSS/JS，无构建依赖。直接用浏览器打开 index.html 即可。
