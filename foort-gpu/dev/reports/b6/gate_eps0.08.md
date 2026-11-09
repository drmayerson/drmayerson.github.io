# Quality gate: eps0.08 vs Reference (512², code 48a078bd6a71)

High with the step parameter eps = 0.08 (instead of 0.03); far steps kept.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 99.971% | 1.9e-1 / 1.4e+0 | 5.4e-3 / 2.0e-2 / 2.3e-2 / 2.2e-2 | 1.2e-1 | 2.2e-3 | 5.8e+0 | 0.999972 | 1.7e-2 | 0.0e+0 | 3.40× |
| kerr_a0_inc80 | 0.00% | 99.951% | 2.4e-1 / 1.0e+0 | 1.8e-2 / 3.5e-2 / 3.0e-2 / 4.6e-2 | 1.7e-1 | 1.1e-2 | 1.3e+0 | 0.999799 | 1.1e-1 | 0.0e+0 | 3.41× |
| kerr_a0.94_inc17 | 0.00% | 99.955% | 1.9e-1 / 1.1e+0 | 4.5e-3 / 2.0e-2 / 2.3e-2 / 2.0e-2 | 1.0e-1 | 2.0e-3 | 4.7e+0 | 0.999971 | -2.3e-2 | 3.3e-1 | 4.74× |
| kerr_a0.94_inc80 | 0.01% | 99.934% | 2.6e-1 / 1.8e+0 | 7.6e-3 / 2.3e-2 / 2.4e-2 / 3.0e-2 | 1.8e-1 | 5.2e-3 | 1.1e+0 | 0.999907 | -2.5e-2 | 7.7e-2 | 2.74× |
| kerr_a0.998_inc80 | 0.02% | 99.932% | 2.6e-1 / 1.8e+0 | 7.2e-3 / 2.2e-2 / 2.3e-2 / 2.9e-2 | 1.8e-1 | 5.0e-3 | 1.6e+0 | 0.999910 | -8.7e-3 | 7.5e-2 | 3.41× |
| johannsen_a0.94_a13_5.5 | 0.00% | 99.934% | 1.9e-1 / 2.6e+0 | 6.2e-3 / 2.2e-2 / 2.6e-2 / 2.3e-2 | 1.4e-1 | 1.7e-3 | 8.6e+0 | 0.999972 | -3.7e-2 | 1.3e-1 | 3.35× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.950% | 2.2e-1 / 1.6e+0 | 5.3e-3 / 2.1e-2 / 2.5e-2 / 2.2e-2 | 1.2e-1 | 3.0e-3 | 6.5e+0 | 0.999954 | -1.3e-3 | 1.1e-1 | 2.47× |
| rn_Q0.8_inc60 | 0.01% | 99.961% | 2.2e-1 / 1.0e+0 | 1.0e-2 / 2.4e-2 / 2.5e-2 / 2.8e-2 | 1.5e-1 | 6.1e-3 | 4.9e+0 | 0.999924 | -1.4e-1 | 7.1e-1 | 4.21× |
| st3cr_l0.05 | 2.09% | 99.947% | 1.7e-1 / 3.0e+0 | 4.4e+3 / 2.3e+3 / 2.6e+3 / 7.9e+3 | 3.6e-1 | 6.5e+3 | 2.6e-2 | 0.358811 | -7.2e-1 | 4.5e-2 | 2.25× |
| st3cr_l5e-3 | 3.30% | 98.355% | 1.8e-1 / 2.9e+0 | 1.1e-3 / 8.9e-4 / 2.9e-3 / 2.8e-3 | 1.9e-1 | 9.4e-4 | 6.2e-2 | 1.000000 | 5.4e-3 | 1.1e-2 | 1.85× |
| st3cr_l1e-3 | 2.47% | 97.083% | 1.8e-1 / 2.3e+0 | 3.4e-4 / 4.9e-4 / 7.5e-4 / 5.2e-4 | 1.6e-2 | 3.0e-4 | 4.3e-1 | 1.000000 | -4.4e-5 | 5.6e-2 | 1.74× |
| st3cr_l1e-4 | 3.04% | 96.557% | 2.3e-1 / 2.3e+0 | 3.2e-4 / 4.4e-4 / 6.6e-4 / 6.9e-4 | 2.3e-2 | 3.3e-4 | 4.1e+0 | 1.000000 | 3.4e-5 | 8.5e-2 | 1.19× |
| st3cr_l0 | 0.07% | 100.000% | 2.3e-1 / 2.3e+0 | 2.5e-4 / 3.7e-4 / 3.3e-4 / 2.3e-4 | 2.4e-3 | 3.2e-4 | 8.6e-3 | 1.000000 | -9.6e-5 | 0.0e+0 | 1.90× |

Normal budgets passed per scene: kerr_a0_inc17: emissionL1, emissionP99, flux, dt; kerr_a0_inc80: emissionL1, emissionP99, flux, dt; kerr_a0.94_inc17: emissionL1, emissionP99, dt; kerr_a0.94_inc80: emissionL1, emissionP99, flux, dt; kerr_a0.998_inc80: emissionL1, emissionP99, flux, dt; johannsen_a0.94_a13_5.5: emissionL1, emissionP99, dt; mankoNovikov_a0.94_a3_2: emissionL1, emissionP99, flux, dt; rn_Q0.8_inc60: emissionL1, emissionP99, flux, dt; st3cr_l0.05: emissionL1, emissionP99, flux, lightCurve, chaoticFlux, chaoticFractions; st3cr_l5e-3: emissionP99, classAgreement, chaoticFractions; st3cr_l1e-3: classAgreement, chaoticFractions; st3cr_l1e-4: emissionP99, dt, classAgreement, chaoticFractions; st3cr_l0: all
