# Quality gate: eps0.06 vs Reference (512², code 48a078bd6a71)

High with the step parameter eps = 0.06 (instead of 0.03); far steps kept.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 99.994% | 7.9e-2 / 6.1e-1 | 1.3e-3 / 7.1e-3 / 7.8e-3 / 7.0e-3 | 3.4e-2 | 6.5e-4 | 1.2e+0 | 0.999995 | 1.2e-2 | 0.0e+0 | 3.83× |
| kerr_a0_inc80 | 0.00% | 99.994% | 9.0e-2 / 5.9e-1 | 4.7e-3 / 1.2e-2 / 1.0e-2 / 1.4e-2 | 4.9e-2 | 3.2e-3 | 3.4e-1 | 0.999964 | 6.6e-3 | 0.0e+0 | 2.88× |
| kerr_a0.94_inc17 | 0.00% | 99.986% | 8.1e-2 / 5.8e-1 | 1.1e-3 / 7.0e-3 / 7.9e-3 / 6.5e-3 | 2.9e-2 | 5.4e-4 | 9.2e-1 | 0.999994 | -5.7e-3 | 3.3e-1 | 1.87× |
| kerr_a0.94_inc80 | 0.01% | 99.986% | 9.1e-2 / 7.0e-1 | 1.9e-3 / 7.8e-3 / 8.6e-3 / 9.8e-3 | 5.1e-2 | 1.3e-3 | 3.7e-1 | 0.999982 | -6.4e-3 | 3.8e-2 | 3.11× |
| kerr_a0.998_inc80 | 0.02% | 99.979% | 9.0e-2 / 7.2e-1 | 1.7e-3 / 7.6e-3 / 8.6e-3 / 9.6e-3 | 5.1e-2 | 1.2e-3 | 5.2e-1 | 0.999983 | -3.1e-3 | 7.5e-2 | 2.27× |
| johannsen_a0.94_a13_5.5 | 0.00% | 99.982% | 7.9e-2 / 6.3e-1 | 1.6e-3 / 7.4e-3 / 9.0e-3 / 7.6e-3 | 3.7e-2 | 4.6e-4 | 2.0e+0 | 0.999995 | -9.3e-3 | 1.3e-1 | 3.21× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.983% | 8.6e-2 / 6.2e-1 | 1.3e-3 / 7.0e-3 / 8.8e-3 / 7.3e-3 | 3.4e-2 | 8.4e-4 | 1.3e+0 | 0.999990 | -3.9e-4 | 1.1e-1 | 2.27× |
| rn_Q0.8_inc60 | 0.01% | 99.986% | 8.8e-2 / 6.3e-1 | 2.5e-3 / 7.7e-3 / 8.5e-3 / 8.7e-3 | 4.0e-2 | 1.8e-3 | 8.7e-1 | 0.999986 | -5.8e-2 | 7.1e-1 | 3.14× |
| st3cr_l0.05 | 2.09% | 99.933% | 4.8e-2 / 1.8e+0 | 6.3e-1 / 3.2e-1 / 5.3e-1 / 7.2e-1 | 2.6e-1 | 4.8e-1 | 1.4e-2 | 0.745297 | 1.2e+0 | 4.4e-2 | 1.35× |
| st3cr_l5e-3 | 3.30% | 98.934% | 5.0e-2 / 1.8e+0 | 1.7e-3 / 1.6e-3 / 1.6e-3 / 1.5e-3 | 5.9e-2 | 1.4e-3 | 2.3e-2 | 0.999996 | 8.6e-3 | 1.0e-1 | 1.66× |
| st3cr_l1e-3 | 2.47% | 98.208% | 5.1e-2 / 1.6e+0 | 2.0e-4 / 2.9e-4 / 5.5e-4 / 3.7e-4 | 1.2e-2 | 1.6e-4 | 2.1e-1 | 1.000000 | -2.1e-4 | 1.2e-1 | 1.65× |
| st3cr_l1e-4 | 3.04% | 97.902% | 6.3e-2 / 1.6e+0 | 1.8e-4 / 2.5e-4 / 4.8e-4 / 5.1e-4 | 1.8e-2 | 1.6e-4 | 1.7e+0 | 1.000000 | -5.0e-5 | 1.6e-1 | 1.44× |
| st3cr_l0 | 0.07% | 100.000% | 6.3e-2 / 1.6e+0 | 1.3e-4 / 1.9e-4 / 1.7e-4 / 1.3e-4 | 1.3e-3 | 1.6e-4 | 4.7e-3 | 1.000000 | -5.8e-5 | 0.0e+0 | 1.67× |

Normal budgets passed per scene: kerr_a0_inc17: emissionL1, emissionP99, dt; kerr_a0_inc80: emissionL1, emissionP99, flux; kerr_a0.94_inc17: emissionL1, emissionP99, dt; kerr_a0.94_inc80: emissionL1, emissionP99; kerr_a0.998_inc80: emissionL1, emissionP99, dt; johannsen_a0.94_a13_5.5: emissionL1, emissionP99, dt; mankoNovikov_a0.94_a3_2: emissionL1, emissionP99, dt; rn_Q0.8_inc60: emissionL1, emissionP99, dt; st3cr_l0.05: emissionL1, emissionP99, flux, lightCurve, chaoticFlux, chaoticFractions; st3cr_l5e-3: emissionP99, classAgreement, chaoticFractions; st3cr_l1e-3: classAgreement, chaoticFractions; st3cr_l1e-4: dt, classAgreement, chaoticFractions; st3cr_l0: all
