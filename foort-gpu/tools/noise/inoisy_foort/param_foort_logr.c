/* param_foort_logr.c: inoisy parameters for FOORT-GPU (plan M8).
   The physics of inoisy's general_xy model (Lee & Gammie 2021: correlation length lam * r along a spiral at angle
   theta to the radial direction, minor axis r12 times shorter, correlation time 2 pi tau / Omega_K along the Keplerian
   flow, all with inoisy's smooth cutoff inside r_ct), written on the grid (x0, x1, x2) = (t, log r, phi), periodic in
   t and phi (model_foort_logr.c). r and t in units of M.

   In (log r, phi) the spatial correlation tensor is scale free: a physical vector a e_r + b e_phi has coordinate
   components (a / r, b / r), so lam r (cos psi e_r + sin psi e_phi) is lam (cos psi, sin psi) in (log r, phi). The
   operator -div(H grad) + 1 is applied in coordinate form, as general_xy does in (x, y); the local correlation
   structure in (log r, phi) is then the specified one (the field is renormalized to unit variance per radius by
   tools/noise/inoisy_to_contract.py).

   Parameters can be set at compile time: -DFOORT_LAM=5 -DFOORT_TAU=1 -DFOORT_R12=0.1 -DFOORT_RCT=1 -DFOORT_T=200
   -DFOORT_XMIN=-3 -DFOORT_XMAX=6.9 -DFOORT_THETA_DEG=-70 (theta: angle of the major axis to the radial direction). */
#include "param.h"

#include <math.h>
#include <time.h>
#include <gsl/gsl_rng.h>
#include <gsl/gsl_randist.h>

#include "hdf5_utils.h"

#define SMALL 1.E-10

#ifndef FOORT_LAM
#define FOORT_LAM 5.
#endif
#ifndef FOORT_TAU
#define FOORT_TAU 1.
#endif
#ifndef FOORT_R12
#define FOORT_R12 0.1
#endif
#ifndef FOORT_RCT
#define FOORT_RCT 1.
#endif
#ifndef FOORT_T
#define FOORT_T 200.
#endif
#ifndef FOORT_XMIN
#define FOORT_XMIN -3.
#endif
#ifndef FOORT_XMAX
#define FOORT_XMAX 6.9
#endif
#ifndef FOORT_THETA_DEG
#define FOORT_THETA_DEG -70.   /* general_xy: -pi/2 + pi/9 = -70 deg */
#endif

const char model_name[] = "foort_logr";

/* Grid domain: t in [0, T), x1 = log(r / M) in [xmin, xmax), phi in [0, 2 pi) (x_end exclusive, as model_set_spacing) */
const double param_x0start = 0.;
const double param_x0end   = FOORT_T;
const double param_x1start = FOORT_XMIN;
const double param_x1end   = FOORT_XMAX;
const double param_x2start = 0.;
const double param_x2end   = 2. * M_PI;

static double param_mass  = 1.E6;
static double param_mdot  = 1.E-7;
static double param_lam   = FOORT_LAM;
static double param_tau   = FOORT_TAU;
static double param_r12   = FOORT_R12;
static double param_rct   = FOORT_RCT;
static double param_theta = FOORT_THETA_DEG * M_PI / 180.;

void param_read_params(char* filename)
{
  if (filename != NULL) {
    hdf5_open(filename);
    hdf5_set_directory("/params/");
    hdf5_read_single_val(&param_mass, "mass", H5T_IEEE_F64LE);
    hdf5_read_single_val(&param_mdot, "mdot", H5T_IEEE_F64LE);
    hdf5_read_single_val(&param_lam, "lam", H5T_IEEE_F64LE);
    hdf5_read_single_val(&param_tau, "tau", H5T_IEEE_F64LE);
    hdf5_read_single_val(&param_r12, "r12", H5T_IEEE_F64LE);
    hdf5_read_single_val(&param_rct, "rct", H5T_IEEE_F64LE);
    hdf5_read_single_val(&param_theta, "theta", H5T_IEEE_F64LE);
    hdf5_close();
  }
}

void param_write_params(char* filename)
{
  hdf5_set_directory("/params/");
  hdf5_write_single_val(&param_mass, "mass", H5T_IEEE_F64LE);
  hdf5_write_single_val(&param_mdot, "mdot", H5T_IEEE_F64LE);
  hdf5_write_single_val(&param_lam, "lam", H5T_IEEE_F64LE);
  hdf5_write_single_val(&param_tau, "tau", H5T_IEEE_F64LE);
  hdf5_write_single_val(&param_r12, "r12", H5T_IEEE_F64LE);
  hdf5_write_single_val(&param_rct, "rct", H5T_IEEE_F64LE);
  hdf5_write_single_val(&param_theta, "theta", H5T_IEEE_F64LE);
}

void param_set_output_name(char* filename, int ni, int nj, int nk,
			   int npi, int npj, int npk, char* dir)
{
  sprintf(filename, "%s/%s_%d_%d_%d_%05lu.h5", dir, model_name,
	  npj * nj, npi * ni, npk * nk, gsl_rng_default_seed);
}

/* inoisy's cutoff (general_xy): matches f(r0), df(r0) at r0, value f0 and zero slope at r = 0 */
static double cutoff(double r, double r0, double fr0, double dfr0, double f0)
{
  double a, b;
  b = (2. * (fr0 - f0) - r0 * dfr0) / pow( r0, 3. );
  a = (fr0 - f0) / (b * r0 * r0) + r0;
  return b * r * r * (a - r) + f0;
}

/* envelope: none (FOORT-GPU applies its own emission model); the raw field is what is used */
double param_env(double raw, double avg_raw, double var_raw,
		 int i, int j, int k, int ni, int nj, int nk,
		 int pi, int pj, int pk, double dx0, double dx1, double dx2)
{
  return (raw - avg_raw) / sqrt(var_raw);
}

static double w_keplerian(double r)
{
  if (r >= param_rct) return pow(r, -1.5);
  return cutoff(r, param_rct, pow(param_rct, -1.5), -1.5 * pow(param_rct, -2.5), 0.9 * pow(param_rct, -1.5));
}

/* physical correlation length (major axis) */
static double corr_length(double r)
{
  if (r >= param_rct) return param_lam * r;
  return cutoff(r, param_rct, param_lam * param_rct, param_lam, 0.9 * param_lam * param_rct);
}

static double corr_time(double r)
{
  if (r >= param_rct) return 2. * M_PI * param_tau / w_keplerian(r);
  return cutoff(r, param_rct, 2. * M_PI * param_tau * pow(param_rct, 1.5),
		2. * M_PI * param_tau * 1.5 * sqrt(param_rct), 0.9 * 2. * M_PI * param_tau * pow(param_rct, 1.5));
}

/* H^{ab} in coordinates (t, log r, phi): lam0^2 u0 u0 + lam1^2 u1 u1 + lam2^2 u2 u2 */
static void set_h(double h[3][3], double x0, double x1, double x2)
{
  int i, j;
  double r = exp(x1);
  double om = w_keplerian(r);
  /* temporal correlation along the Keplerian flow: dphi/dt = Omega, d(log r)/dt = 0 */
  double u0[3] = {1., 0., om};
  /* spatial axes: angle psi to the radial direction, trailing for Omega > 0 (as general_xy) */
  double psi = copysign(param_theta, -om);
  double l1 = corr_length(r) / r, l2 = param_r12 * l1;   /* coordinate lengths in (log r, phi) */
  double u1[3] = {0., cos(psi), sin(psi)};
  double u2[3] = {0., -sin(psi), cos(psi)};
  double l0 = corr_time(r);
  for (i = 0; i < 3; i++)
    for (j = 0; j < 3; j++)
      h[i][j] = l0 * l0 * u0[i] * u0[j] + l1 * l1 * u1[i] * u1[j] + l2 * l2 * u2[i] * u2[j];
}

/* dh[i][j][k] = d h[i][j] / dx_k (central differences, as general_xy) */
static void set_dh(double dh[][3][3], double x0, double x1, double x2, double dx0, double dx1, double dx2)
{
  int i, j, k;
  double dx[3] = {dx0, dx1, dx2};
  double hm[3][3][3], hp[3][3][3];
  set_h(hm[0], x0 - dx0, x1, x2);
  set_h(hp[0], x0 + dx0, x1, x2);
  set_h(hm[1], x0, x1 - dx1, x2);
  set_h(hp[1], x0, x1 + dx1, x2);
  set_h(hm[2], x0, x1, x2 - dx2);
  set_h(hp[2], x0, x1, x2 + dx2);
  for (i = 0; i < 3; i++)
    for (j = 0; j < 3; j++)
      for (k = 0; k < 3; k++)
	dh[i][j][k] = 0.5 * ( hp[k][i][j] - hm[k][i][j] ) / dx[k];
}

void param_coeff(double* coeff, double x0, double x1, double x2, double dx0,
		  double dx1, double dx2, int index)
{
  double h[3][3], dh[3][3][3];
  set_h(h, x0, x1, x2);
  set_dh(dh, x0, x1, x2, dx0, dx1, dx2);
  /* same discretization as general_xy, with (x, y) -> (log r, phi) */
  coeff[0] = -h[2][2] / (dx2 * dx2);
  coeff[1] = -0.5 * h[1][2] / (dx1 * dx2);
  coeff[2] = -h[1][1] / (dx1 * dx1);
  coeff[3] = -0.5 * h[0][2] / (dx0 * dx2);
  coeff[4] = -0.5 * h[0][1] / (dx0 * dx1);
  coeff[5] = -h[0][0] / (dx0 * dx0);
  coeff[6] = -0.5 * ( dh[0][2][0] + dh[1][2][1] + dh[2][2][2] ) / dx2;
  coeff[7] = -0.5 * ( dh[0][1][0] + dh[1][1][1] + dh[2][1][2] ) / dx1;
  coeff[8] = -0.5 * ( dh[0][0][0] + dh[1][0][1] + dh[2][0][2] ) / dx0;
  coeff[9] = -2. * ( coeff[0] + coeff[2] + coeff[5] ) + 1.;
}

void param_set_source(double* values, gsl_rng* rstate, int ni, int nj, int nk,
		      int pi, int pj, int pk, int npi, int npj, int npk,
		      double dx0, double dx1, double dx2, int nrecur)
{
  int i;
  int nvalues = ni * nj * nk;
  /* white noise scaled by sqrt(det Lambda) (Lindgren et al. 2011), as general_xy, with coordinate lengths */
  double factor = pow(4. * M_PI, 3. / 2.) * tgamma(2. * nrecur) / tgamma(2. * nrecur - 3. / 2.);
  for (i = 0; i < nvalues; i++) {
    int gridk = i / (ni * nj);
    int gridj = (i - ni * nj * gridk) / ni;
    gridj += pj * nj;
    double r = exp(param_x1start + dx1 * gridj);
    double l1 = corr_length(r) / r;
    double scaling = factor * corr_time(r) * l1 * param_r12 * l1;
    scaling = fmax( sqrt(scaling), SMALL );
    values[i] = gsl_ran_gaussian_ziggurat(rstate, 1.) * scaling;
  }
}
