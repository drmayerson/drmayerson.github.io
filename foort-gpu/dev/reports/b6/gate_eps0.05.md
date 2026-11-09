# Quality gate: eps0.05 vs Reference (512², code 48a078bd6a71)

High with the step parameter eps = 0.05 (instead of 0.03); far steps kept.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 99.996% | 5.2e-2 / 4.5e-1 | 5.8e-4 / 3.5e-3 / 3.8e-3 / 3.3e-3 | 1.6e-2 | 3.0e-4 | 3.7e-1 | 0.999999 | 5.8e-3 | 0.0e+0 | 1.81× |
| kerr_a0_inc80 | 0.00% | 99.994% | 5.6e-2 / 4.5e-1 | 2.1e-3 / 5.6e-3 / 5.1e-3 / 6.4e-3 | 2.2e-2 | 1.1e-3 | 1.5e-1 | 0.999990 | 2.1e-3 | 0.0e+0 | 2.57× |
| kerr_a0.94_inc17 | 0.00% | 99.994% | 5.8e-2 / 4.5e-1 | 4.6e-4 / 3.4e-3 / 3.9e-3 / 3.1e-3 | 1.4e-2 | 2.4e-4 | 3.3e-1 | 0.999998 | -2.5e-3 | 3.3e-1 | 2.14× |
| kerr_a0.94_inc80 | 0.01% | 99.993% | 5.7e-2 / 5.3e-1 | 7.8e-4 / 3.8e-3 / 4.3e-3 / 4.7e-3 | 2.3e-2 | 6.2e-4 | 1.8e-1 | 0.999995 | -2.4e-3 | 3.8e-2 | 2.38× |
| kerr_a0.998_inc80 | 0.02% | 99.992% | 5.7e-2 / 5.4e-1 | 7.3e-4 / 3.8e-3 / 4.3e-3 / 4.6e-3 | 2.2e-2 | 6.4e-4 | 2.5e-1 | 0.999995 | -1.3e-3 | 7.5e-2 | 1.95× |
| johannsen_a0.94_a13_5.5 | 0.00% | 99.995% | 5.3e-2 / 4.3e-1 | 6.7e-4 / 3.6e-3 / 4.4e-3 / 3.6e-3 | 1.7e-2 | 2.0e-4 | 7.4e-1 | 0.999999 | -4.0e-3 | 0.0e+0 | 2.33× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.991% | 5.9e-2 / 4.8e-1 | 5.4e-4 / 3.4e-3 / 4.4e-3 / 3.5e-3 | 1.5e-2 | 3.7e-4 | 4.7e-1 | 0.999997 | -1.6e-4 | 7.4e-2 | 2.28× |
| rn_Q0.8_inc60 | 0.01% | 99.992% | 5.7e-2 / 4.9e-1 | 1.1e-3 / 3.7e-3 / 4.1e-3 / 4.1e-3 | 1.8e-2 | 8.5e-4 | 6.1e-1 | 0.999996 | -2.7e-2 | 7.1e-1 | 1.77× |
| st3cr_l0.05 | 2.09% | 99.945% | 9.2e-2 / 1.7e+0 | 8.9e-1 / 4.7e-1 / 6.8e-1 / 1.1e+0 | 1.9e-1 | 1.9e-1 | 1.1e-2 | 0.878407 | -8.1e-1 | 3.4e-2 | 1.69× |
| st3cr_l5e-3 | 3.30% | 99.077% | 9.7e-2 / 1.6e+0 | 3.6e-4 / 3.9e-4 / 1.1e-3 / 7.5e-4 | 5.6e-2 | 2.1e-4 | 1.7e-2 | 1.000000 | 6.6e-4 | 1.9e-1 | 1.78× |
| st3cr_l1e-3 | 2.47% | 98.440% | 1.0e-1 / 1.3e+0 | 1.3e-4 / 2.0e-4 / 4.4e-4 / 2.9e-4 | 1.2e-2 | 8.4e-5 | 9.2e-2 | 1.000000 | -3.5e-4 | 2.1e-1 | 1.71× |
| st3cr_l1e-4 | 3.04% | 98.490% | 1.3e-1 / 1.3e+0 | 1.3e-4 / 1.7e-4 / 3.4e-4 / 4.2e-4 | 1.7e-2 | 1.0e-4 | 6.7e-1 | 1.000000 | -2.2e-5 | 2.4e-1 | 1.55× |
| st3cr_l0 | 0.07% | 100.000% | 1.4e-1 / 1.3e+0 | 8.0e-5 / 1.2e-4 / 1.0e-4 / 7.9e-5 | 8.2e-4 | 9.4e-5 | 3.0e-3 | 1.000000 | -2.8e-5 | 0.0e+0 | 1.49× |

Normal budgets passed per scene: kerr_a0_inc17: emissionL1; kerr_a0_inc80: emissionL1, emissionP99; kerr_a0.94_inc17: emissionL1; kerr_a0.94_inc80: emissionL1, emissionP99; kerr_a0.998_inc80: emissionL1, emissionP99; johannsen_a0.94_a13_5.5: emissionL1, dt; mankoNovikov_a0.94_a3_2: emissionL1; rn_Q0.8_inc60: emissionL1, dt; st3cr_l0.05: emissionL1, emissionP99, flux, lightCurve, chaoticFlux, chaoticFractions; st3cr_l5e-3: emissionP99, classAgreement, chaoticFractions; st3cr_l1e-3: classAgreement, chaoticFractions; st3cr_l1e-4: dt, classAgreement, chaoticFractions; st3cr_l0: all
