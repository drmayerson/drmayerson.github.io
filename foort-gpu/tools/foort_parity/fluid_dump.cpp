// FOORT parity harness for the fluid model: build FOORT's GeneralCircularRadialFluid on a FOORT metric
// (rLogScale = true, as in the M2 parity runs) and print its ISCO and four-velocity at given radii.
// Builds against a local, unmodified FOORT clone (see build.sh).
//
// Usage:  fluid_dump <Kerr|Johannsen|MankoNovikov> <params...> <xi> <betar> <betaphi>  < radii.txt  > out.csv
//   Kerr a | Johannsen a alpha13 alpha22 alpha52 eps3 | MankoNovikov a alpha3
//   ISCO search bounds: FOORT defaults (horizon radius, 10 x horizon radius).
//   stderr: the fluid model's description (contains the ISCO radius).
//   out.csv: r, u_t, u_r, u_theta, u_phi (covariant, true r; FOORT's u_x in x = log r divided by r), %.17g.

#include "Metric.h"
#include "DiagnosticsEmission.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>

int main(int argc, char **argv)
{
	if (argc < 6)
	{
		std::fprintf(stderr, "usage: fluid_dump <metric> <params...> <xi> <betar> <betaphi> < radii.txt\n");
		return 2;
	}
	const std::string name = argv[1];
	auto arg = [&](int i) { return std::strtod(argv[i], nullptr); };
	std::unique_ptr<SphericalHorizonMetric> m;
	int k = 0;
	if (name == "Kerr" && argc == 6) { m = std::make_unique<KerrMetric>(arg(2), true); k = 3; }
	else if (name == "Johannsen" && argc == 10) { m = std::make_unique<JohannsenMetric>(arg(2), arg(3), arg(4), arg(5), arg(6), true); k = 7; }
	else if (name == "MankoNovikov" && argc == 7) { m = std::make_unique<MankoNovikovMetric>(arg(2), arg(3), true); k = 4; }
	else
	{
		std::fprintf(stderr, "unknown metric or wrong number of parameters\n");
		return 2;
	}
	const real rh = m->getHorizonRadius();
	GeneralCircularRadialFluid fluid(arg(k), arg(k + 1), arg(k + 2), m.get(), rh, 10.0 * rh);
	std::fprintf(stderr, "%s\n", fluid.getFullDescriptionStr().c_str());
	double r;
	while (std::scanf(" %lf", &r) == 1)
	{
		OneIndex u = fluid.GetFourVelocityd(Point{0.0, std::log(r), M_PI / 2.0, 0.0});
		std::printf("%.17g,%.17g,%.17g,%.17g,%.17g\n", r, u[0], u[1] / r, u[2], u[3]);
	}
	return 0;
}
