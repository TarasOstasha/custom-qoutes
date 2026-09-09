/** Rewrites `eval` bindings in advanced-calculator so webpack can parse the package in strict mode. */
module.exports = function advancedCalculatorEvalLoader(source) {
  return source
    .replace(/eval: eval,/g, "eval: evaluateNode,")
    .replace(/function genFunc\(eval,/g, "function genFunc(evaluateNode,")
    .replace(/tree\.val\.eval\(eval\(/g, "tree.val.eval(evaluateNode(")
    .replace(/evaluateNode\(tree\.left\), eval\(tree\.right\)/g, "evaluateNode(tree.left), evaluateNode(tree.right)")
    .replace(/function eval\(tree\)/g, "function evaluateNode(tree)")
    .replace(/let \{ RPN, eval, parse \}/g, "let { RPN, eval: evaluateNode, parse }")
    .replace(/ans = eval\(tree\)/g, "ans = evaluateNode(tree)")
    .replace(/module\.exports = \{ RPN, eval, parse \}/g, "module.exports = { RPN, eval: evaluateNode, parse }");
};
