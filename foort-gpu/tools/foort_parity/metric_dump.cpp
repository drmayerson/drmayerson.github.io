// FOORT parity harness: evaluate a FOORT metric at given (r, theta) points and print g_dd and g_uu.
// Builds against a local, unmodified FOORT clone (see build.sh). Always uses FOORT's normal r
// coordinate (rLogScale = false) so the comparison is in the true r.
//
// Usage:  metric_dump <Kerr|Johannsen|MankoNovikov|ST3Cr> <params...>  < points.csv  > out.csv
//   Kerr a | Johannsen a alpha13 alpha22 alpha52 eps3 | MankoNovikov a alpha3 | ST3Cr P q0 lambda
//   points.csv: one "r,theta" per line.
//   out.csv: r,theta, gdd00..gdd33 (16, row-major), guu00..guu33 (16), printed with %.17g.

#include "Metric.h"

#include <cstdio>
#include <cstdlib>
#include <memory>
#include <stdexcept>
#include <string>

int main(int argc, char **argv)
{
	if (argc < 3)
	{
		std::fprintf(stderr, "usage: metric_dump <metric> <params...> < points.csv\n");
		return 2;
	}
	const std::string name = argv[1];
	auto arg = [&](int i) { return std::strtod(argv[i], nullptr); };
	std::unique_ptr<Metric> m;
	if (name == "Kerr" && argc == 3)
		m = std::make_unique<KerrMetric>(arg(2), false);
	else if (name == "Johannsen" && argc == 7)
		m = std::make_unique<JohannsenMetric>(arg(2), arg(3), arg(4), arg(5), arg(6), false);
	else if (name == "MankoNovikov" && argc == 4)
		m = std::make_unique<MankoNovikovMetric>(arg(2), arg(3), false);
	else if (name == "ST3Cr" && argc == 5)
		m = std::make_unique<ST3CrMetric>(arg(2), arg(3), arg(4), false);
	else
	{
		std::fprintf(stderr, "unknown metric or wrong number of parameters\n");
		return 2;
	}

	double r, th;
	while (std::scanf(" %lf , %lf", &r, &th) == 2)
	{
		Point p{0.0, r, th, 0.0};
		TwoIndex gdd = m->getMetric_dd(p);
		TwoIndex guu = m->getMetric_uu(p);
		std::printf("%.17g,%.17g", r, th);
		for (int i = 0; i < 4; ++i)
			for (int j = 0; j < 4; ++j)
				std::printf(",%.17g", gdd[i][j]);
		for (int i = 0; i < 4; ++i)
			for (int j = 0; j < 4; ++j)
				std::printf(",%.17g", guu[i][j]);
		std::printf("\n");
	}
	return 0;
}
