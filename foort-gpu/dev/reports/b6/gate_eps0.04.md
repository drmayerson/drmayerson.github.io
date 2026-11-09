# Quality gate: eps0.04 vs Reference (512², code df05f99d6c2c)

High with the step parameter eps = 0.04 (instead of 0.03); far steps kept.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 99.997% | 3.3e-2 / 3.4e-1 | 2.1e-4 / 1.4e-3 / 1.5e-3 / 1.4e-3 | 6.4e-3 | 1.2e-4 | 2.1e-1 | 1.000000 | 2.3e-3 | 0.0e+0 | 1.47× |
| kerr_a0_inc80 | 0.00% | 99.997% | 3.4e-2 / 3.4e-1 | 7.8e-4 / 2.3e-3 / 2.1e-3 / 2.5e-3 | 9.0e-3 | 4.0e-4 | 6.1e-2 | 0.999998 | 6.8e-4 | 0.0e+0 | 1.80× |
| kerr_a0.94_inc17 | 0.00% | 99.997% | 4.1e-2 / 3.5e-1 | 1.7e-4 / 1.4e-3 / 1.6e-3 / 1.3e-3 | 6.0e-3 | 1.0e-4 | 2.0e-1 | 1.000000 | -8.9e-4 | 2.5e-1 | 1.89× |
| kerr_a0.94_inc80 | 0.01% | 100.000% | 3.7e-2 / 4.1e-1 | 2.8e-4 / 1.6e-3 / 1.8e-3 / 1.9e-3 | 8.7e-3 | 3.1e-4 | 7.6e-2 | 0.999999 | -7.8e-4 | 3.8e-2 | 1.16× |
| kerr_a0.998_inc80 | 0.02% | 99.998% | 3.7e-2 / 4.2e-1 | 2.6e-4 / 1.6e-3 / 1.8e-3 / 1.9e-3 | 8.5e-3 | 3.1e-4 | 1.1e-1 | 0.999999 | -4.6e-4 | 7.5e-2 | 1.87× |
| johannsen_a0.94_a13_5.5 | 0.00% | 99.999% | 3.6e-2 / 3.1e-1 | 2.5e-4 / 1.5e-3 / 1.8e-3 / 1.4e-3 | 6.9e-3 | 7.4e-5 | 2.8e-1 | 1.000000 | -1.5e-3 | 0.0e+0 | 1.93× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.996% | 4.1e-2 / 3.7e-1 | 2.0e-4 / 1.4e-3 / 1.8e-3 / 1.4e-3 | 6.5e-3 | 1.7e-4 | 3.0e-1 | 0.999999 | -5.5e-5 | 3.7e-2 | 1.79× |
| rn_Q0.8_inc60 | 0.01% | 99.998% | 3.6e-2 / 3.8e-1 | 3.9e-4 / 1.5e-3 / 1.7e-3 / 1.6e-3 | 6.8e-3 | 3.5e-4 | 4.3e-1 | 0.999999 | -1.0e-2 | 7.1e-1 | 1.84× |
| st3cr_l0.05 | 2.09% | 99.940% | 6.5e-2 / 1.2e+0 | 7.0e-1 / 4.6e-1 / 4.1e-1 / 9.1e-1 | 1.2e-1 | 7.7e+0 | 5.5e-3 | 0.363527 | 3.0e+1 | 2.2e-2 | 1.33× |
| st3cr_l5e-3 | 3.30% | 99.092% | 6.6e-2 / 1.1e+0 | 2.4e-4 / 2.0e-4 / 5.3e-4 / 5.3e-4 | 1.6e-2 | 2.2e-4 | 5.6e-3 | 1.000000 | 1.6e-5 | 3.1e-1 | 1.76× |
| st3cr_l1e-3 | 2.47% | 98.226% | 7.3e-2 / 1.0e+0 | 6.9e-5 / 9.9e-5 / 2.2e-4 / 1.4e-4 | 4.9e-3 | 4.2e-5 | 4.2e-2 | 1.000000 | -3.1e-4 | 3.2e-1 | 1.75× |
| st3cr_l1e-4 | 3.04% | 98.104% | 1.0e-1 / 1.0e+0 | 8.6e-5 / 1.1e-4 / 2.6e-4 / 3.6e-4 | 1.5e-2 | 4.7e-5 | 3.3e-1 | 1.000000 | -3.6e-6 | 3.5e-1 | 1.65× |
| st3cr_l0 | 0.07% | 100.000% | 1.0e-1 / 1.0e+0 | 4.4e-5 / 6.5e-5 / 5.7e-5 / 4.8e-5 | 4.7e-4 | 4.1e-5 | 1.8e-3 | 1.000000 | -6.6e-7 | 0.0e+0 | 1.25× |

Normal budgets passed per scene: kerr_a0_inc17: all; kerr_a0_inc80: all; kerr_a0.94_inc17: all; kerr_a0.94_inc80: all; kerr_a0.998_inc80: all; johannsen_a0.94_a13_5.5: all; mankoNovikov_a0.94_a3_2: all; rn_Q0.8_inc60: all; st3cr_l0.05: emissionL1, emissionP99, flux, lightCurve, chaoticFlux, chaoticFractions; st3cr_l5e-3: classAgreement, chaoticFractions; st3cr_l1e-3: classAgreement, chaoticFractions; st3cr_l1e-4: classAgreement, chaoticFractions; st3cr_l0: all
