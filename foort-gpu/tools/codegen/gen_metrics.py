"""Stage 1B B5: closed-form metric shaders, generated from symbolic metrics (dev-time only; the .glsl output is committed).

For each metric this writes shaders/glsl/closed/<id>.glsl with

    uniform vec4 uClosed;   // the metric's parameters (see PARAMS below)
    void lookupTables(float x, float delta, float hemi, out float v[5], out float dx[5], out float dd[5]);

the same interface as the tabulated lookup of trace.glsl (which provides the Hamiltonian, its force with the dmomQ
split for the constraint projection, radiusOf and the singularity test, and is compiled with CLOSED_FORM defined so
that it skips its own table lookup). The functions are those of the tables (js/bake/bake.js):

    G0 = g^tt, G1 = g^tphi, G2 = sin^2(theta) g^phiphi, G3 = g^xx = g^rr / e^2, G4 = g^thth,

with x = log e, e = r - r0 (r0 = r_+ for these horizon metrics), their x-derivatives (e d/de) and their derivatives
with respect to delta, the distance to the nearer pole (d/d delta = hemi d/d theta).

Float32 safety:
  - everything is written in e = r - r_+ with Delta factorized as e (e + r_+ - r_-), so g^rr / e^2 and 1/Delta have no
    cancellation near the horizon (r^2 + a^2 - 2r would lose ~5 digits at the 1.01 r_+ termination);
  - the angle enters as S = sin(theta) = sin(delta) and C = cos(theta) = hemi cos(delta): no pi - delta rounding at the
    south pole (the reason for the delta state of common.glsl);
  - integer powers are written as products (GLSL pow(x, y) is undefined for x < 0);
  - G2 is simplified so that the 1/sin^2 of g^phiphi cancels (regular on the axis).

Usage: python tools/codegen/gen_metrics.py [ids...]      (from foort-gpu/; default: all)
"""
import os
import sys

import sympy as sp
from sympy.printing.glsl import GLSLPrinter
from sympy.printing.jscode import JavascriptCodePrinter

e, S, C = sp.symbols('e S C', positive=True)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'shaders', 'glsl', 'closed')
# the same expressions as JavaScript, for the unit tests (dev/tests/unit/b5.test.js compares them with the JS metrics)
OUT_JS = os.path.join(HERE, '..', '..', 'dev', 'tests', 'unit', 'closed')


class Printer(GLSLPrinter):
    """GLSL with integer powers as products and float literals."""

    def _print_Pow(self, expr):
        b, n = expr.base, expr.exp
        if n.is_Integer:
            k = int(n)
            if k == 0:
                return '1.0'
            base = self.parenthesize(b, 100)
            prod = '*'.join([base] * abs(k))
            if abs(k) > 1:
                prod = '(' + prod + ')'
            return prod if k > 0 else '(1.0/' + prod + ')'
        if n == sp.Rational(1, 2):
            return 'sqrt(%s)' % self._print(b)
        if n == -sp.Rational(1, 2):
            return '(1.0/sqrt(%s))' % self._print(b)
        return 'pow(%s, %s)' % (self._print(b), self._print(sp.Float(n)))

    def _print_Rational(self, expr):
        return '(%s/%s)' % (sp.Float(expr.p), sp.Float(expr.q))

    def _print_Integer(self, expr):
        return self._print(sp.Float(expr))

    def _print_Float(self, expr):
        s = sp.printing.str.StrPrinter({'full_prec': False})._print_Float(expr)
        if 'e' not in s and '.' not in s:
            s += '.0'
        return s


def kerr():
    a, rp, rm = sp.symbols('a rp rm', real=True)
    r = rp + e
    Sig = r**2 + a**2 * C**2
    D1 = e + rp - rm                      # Delta = e D1
    Delta = e * D1
    A = (r**2 + a**2)**2 - Delta * a**2 * S**2
    G = [-A / (Sig * Delta), -2 * a * r / (Sig * Delta), (Delta - a**2 * S**2) / (Sig * Delta), D1 / (e * Sig), 1 / Sig]
    sub = {rp: 1 + sp.sqrt(1 - a**2), rm: 1 - sp.sqrt(1 - a**2)}
    return G, [a], {'rp': sub[rp], 'rm': sub[rm]}, (rp, rm)


def johannsen():
    a, al13, al22, al52, eps3, rp, rm = sp.symbols('a alpha13 alpha22 alpha52 eps3 rp rm', real=True)
    r = rp + e
    A1 = 1 + al13 / r**3
    A2 = 1 + al22 / r**2
    A5 = 1 + al52 / r**2
    rho2 = r**2 + a**2 * C**2 + eps3 / r
    D1 = e + rp - rm
    Delta = e * D1
    G = [(-((r**2 + a**2) * A1)**2 + a**2 * Delta * S**2) / (Delta * rho2),
         -a * (A2 * A1 * (r**2 + a**2) - Delta) / (Delta * rho2),
         (-a**2 * A2**2 * S**2 + Delta) / (Delta * rho2),
         D1 * A5 / (e * rho2),
         1 / rho2]
    return G, [a, al13, al22, al52, eps3], {'rp': 1 + sp.sqrt(1 - a**2), 'rm': 1 - sp.sqrt(1 - a**2)}, (rp, rm)


def reissnerNordstrom():
    Q, rp, rm = sp.symbols('Q rp rm', real=True)
    r = rp + e
    D1 = e + rp - rm                      # r^2 f = (r - r_+)(r - r_-) = e D1
    f = e * D1 / r**2
    G = [-1 / f, sp.Integer(0), 1 / r**2, D1 / (e * r**2), 1 / r**2]
    return G, [Q], {'rp': 1 + sp.sqrt(1 - Q**2), 'rm': 1 - sp.sqrt(1 - Q**2)}, (rp, rm)


def mankoNovikov():
    a, al3, k, alpha = sp.symbols('a alpha3 k alpha', real=True)
    r = 1 + k + e                         # r_+ = 1 + k
    xx = (r - 1) / k
    yy = C
    R = sp.sqrt(xx**2 + yy**2 - 1)
    P1 = xx * yy / R
    P2 = sp.Rational(1, 2) * (3 * xx**2 * yy**2 / R**2 - 1)
    P3 = sp.Rational(1, 2) * (5 * (xx * yy / R)**3 - 3 * xx * yy / R)
    P4 = sp.Rational(1, 8) * (35 * (xx * yy / R)**4 - 30 * xx**2 * yy**2 / R**2 + 3)
    aa = -alpha * sp.exp(2 * al3 * (1 - (xx - yy) * (1 / R + P1 / R**2 + P2 / R**3 + P3 / R**4)))
    bb = alpha * sp.exp(2 * al3 * (-1 + (xx + yy) * (1 / R - P1 / R**2 + P2 / R**3 - P3 / R**4)))
    AA = (xx**2 - 1) * (1 + aa * bb)**2 - (1 - yy**2) * (bb - aa)**2
    BB = (xx + 1 + (xx - 1) * aa * bb)**2 + ((1 + yy) * aa + (1 - yy) * bb)**2
    CC = (xx**2 - 1) * (1 + aa * bb) * (bb - aa - yy * (aa + bb)) + (1 - yy**2) * (bb - aa) * (1 + aa * bb + xx * (1 - aa * bb))
    psi = al3 * P3 / R**4
    gp = 2 * al3**2 * (P4**2 - P3**2) / R**8 + 2 * al3 * (-yy + xx * P1 / R - yy * P2 / R**2 + xx * P3 / R**3) / R
    f = sp.exp(2 * psi) * AA / BB
    e2g = sp.exp(2 * gp) * AA / ((xx**2 - yy**2) * (1 - alpha**2)**2)
    om = 2 * k * sp.exp(-2 * psi) * CC / AA - 4 * k * alpha / (1 - alpha**2)
    rho2 = (r - 1)**2 - k**2 * C**2
    D1 = e + 2 * k                        # Delta = (r - 1)^2 - k^2 = e (e + 2k)
    Delta = e * D1
    # inverse of the (t, phi) block [[-f, om f], [om f, -f om^2 + Delta S^2 / f]]: determinant -Delta S^2, so
    # g^tt = -(-f om^2 + Delta S^2/f) / (Delta S^2), g^tphi = om f / (Delta S^2), S^2 g^phiphi = f / Delta
    G = [(f * om**2 - Delta * S**2 / f) / (Delta * S**2),
         om * f / (Delta * S**2),
         f / Delta,
         D1 * f / (e2g * rho2 * e),
         f / (e2g * rho2)]
    # g^tt and g^tphi: the 1/S^2 cancels analytically (om ~ S^2 near the axis); left to the evaluation, with S >= the
    # axis floor of the tracer it stays finite
    return G, [a, al3], {'k': sp.sqrt(1 - a**2), 'alpha': None}, (k, alpha)


METRICS = {
    'kerr': kerr,
    'johannsen': johannsen,
    'reissnerNordstrom': reissnerNordstrom,
    'mankoNovikov': mankoNovikov,
}


def generate(mid):
    G, params, derived, dsyms = METRICS[mid]()
    th = sp.Symbol('theta')
    out = []
    for g in G:
        g = sp.sympify(g)
        if mid != 'mankoNovikov':
            g = sp.together(g)
        gx = e * sp.diff(g, e)
        # d/dtheta with S = sin, C = cos: dS/dtheta = C, dC/dtheta = -S
        gt = C * sp.diff(g, S) - S * sp.diff(g, C)
        out += [g, gx, gt]
    names = [f'{w}[{l}]' for l in range(5) for w in ('v', 'dx', 'dd')]
    reps, red = sp.cse(out, symbols=sp.numbered_symbols('t'), optimizations='basic')
    P = Printer()
    lines = []
    lines.append(f'// GENERATED by tools/codegen/gen_metrics.py from the symbolic metric "{mid}" -- do not edit.')
    lines.append('// Closed-form lookupTables for trace.glsl (compiled with CLOSED_FORM): G0..G4 of js/bake/bake.js, their x- and')
    lines.append('// delta-derivatives, x = log(r - r_+), theta from (delta, hemi) as S = sin(delta), C = hemi cos(delta).')
    lines.append(f'uniform vec4 uClosed;   // {", ".join(str(p) for p in params[:4])}')
    if len(params) > 4:
        lines.append(f'uniform vec4 uClosed2;  // {", ".join(str(p) for p in params[4:])}')
    lines.append(f'uniform vec4 uClosedD;  // derived: {", ".join(str(s) for s in dsyms)}')
    lines.append('void lookupTables(float x, float delta, float hemi, out float v[5], out float dx[5], out float dd[5]) {')
    for i, p in enumerate(params):
        lines.append(f'  float {p} = {"uClosed" if i < 4 else "uClosed2"}.{"xyzw"[i % 4]};')
    for i, s in enumerate(dsyms):
        lines.append(f'  float {s} = uClosedD.{"xyzw"[i]};')
    lines.append('  float e = exp(x), S = sin(delta), C = hemi * cos(delta);')
    used = set()
    for s, ex in reps:
        lines.append(f'  float {s} = {P.doprint(ex)};')
    for n, ex in zip(names, red):
        lines.append(f'  {n} = {P.doprint(ex)};')
    lines.append('  for (int l = 0; l < 5; l++) dd[l] *= hemi;   // d/d delta = hemi d/d theta')
    lines.append('}')
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{mid}.glsl')
    with open(path, 'w', newline='\n') as fh:
        fh.write('\n'.join(lines) + '\n')
    J = JavascriptCodePrinter()
    js = [f'// GENERATED by tools/codegen/gen_metrics.py from the symbolic metric "{mid}" -- do not edit (test mirror of shaders/glsl/closed/{mid}.glsl).',
          f'export const params = {[str(p) for p in params]!r};'.replace("'", '"'),
          f'export const derived = {[str(s) for s in dsyms]!r};'.replace("'", '"'),
          '/** G0..G4, their x- and delta-derivatives at (x, delta, hemi); P: parameters by name, D: derived by name */',
          'export function lookup(x, delta, hemi, P, D) {']
    for p in params:
        js.append(f'  const {p} = P.{p};')
    for s_ in dsyms:
        js.append(f'  const {s_} = D.{s_};')
    js.append('  const e = Math.exp(x), S = Math.sin(delta), C = hemi * Math.cos(delta);')
    for s_, ex in reps:
        js.append(f'  const {s_} = {J.doprint(ex)};')
    js.append('  const v = [], dx = [], dd = [];')
    for n, ex in zip(names, red):
        js.append(f'  {n} = {J.doprint(ex)};')
    js.append('  for (let l = 0; l < 5; l++) dd[l] *= hemi;')
    js.append('  return { v, dx, dd };')
    js.append('}')
    os.makedirs(OUT_JS, exist_ok=True)
    with open(os.path.join(OUT_JS, f'{mid}.js'), 'w', newline='\n') as fh:
        fh.write('\n'.join(js) + '\n')
    print(f'{mid}: {len(reps)} common subexpressions, {sum(len(l) for l in lines)} chars -> {os.path.relpath(path)}')


if __name__ == '__main__':
    for mid in (sys.argv[1:] or list(METRICS)):
        generate(mid)
