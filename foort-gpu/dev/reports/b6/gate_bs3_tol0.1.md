# Quality gate: bs3_tol0.1 vs Reference (512², code 48a078bd6a71)

High with the Bogacki-Shampine 3(2) integrator, tolerance 0.1 pixel angles, steps capped at 4x FOORT's rule.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 99.998% | 7.5e-3 / 7.7e-2 | 1.6e-4 / 1.5e-3 / 1.4e-3 / 1.3e-3 | 5.6e-3 | 1.8e-4 | 1.6e-1 | 1.000000 | 8.3e-5 | 0.0e+0 | 2.17× |
| kerr_a0_inc80 | 0.00% | 100.000% | 7.1e-3 / 7.2e-2 | 3.5e-4 / 1.4e-3 / 1.6e-3 / 1.5e-3 | 5.2e-3 | 5.9e-4 | 2.2e-2 | 0.999998 | -1.2e-4 | 0.0e+0 | 1.51× |
| kerr_a0.94_inc17 | 0.00% | 99.998% | 1.0e-2 / 8.5e-2 | 1.7e-4 / 1.5e-3 / 1.7e-3 / 1.3e-3 | 6.5e-3 | 1.7e-4 | 1.4e-1 | 1.000000 | 2.7e-4 | 8.3e-2 | 1.29× |
| kerr_a0.94_inc80 | 0.01% | 99.999% | 8.5e-3 / 9.6e-2 | 2.8e-4 / 1.4e-3 / 1.6e-3 / 1.6e-3 | 5.2e-3 | 2.5e-4 | 2.3e-2 | 0.999999 | -1.3e-4 | 0.0e+0 | 0.93× |
| kerr_a0.998_inc80 | 0.02% | 99.999% | 8.6e-3 / 9.8e-2 | 2.9e-4 / 1.5e-3 / 1.7e-3 / 1.7e-3 | 5.3e-3 | 2.4e-4 | 2.8e-2 | 0.999999 | 6.7e-5 | 0.0e+0 | 1.88× |
| johannsen_a0.94_a13_5.5 | 0.00% | 99.999% | 8.5e-3 / 8.3e-2 | 2.0e-4 / 1.6e-3 / 1.7e-3 / 1.5e-3 | 6.0e-3 | 2.1e-4 | 2.3e-1 | 1.000000 | 4.5e-4 | 0.0e+0 | 1.79× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.998% | 9.4e-3 / 9.1e-2 | 1.8e-4 / 1.4e-3 / 1.8e-3 / 1.4e-3 | 6.4e-3 | 2.2e-4 | 1.3e-1 | 0.999999 | 4.1e-3 | 0.0e+0 | 2.17× |
| rn_Q0.8_inc60 | 0.01% | 100.000% | 8.1e-3 / 8.1e-2 | 2.4e-4 / 1.3e-3 / 1.4e-3 / 1.3e-3 | 5.1e-3 | 4.1e-4 | 8.2e-2 | 0.999999 | 8.6e-4 | 0.0e+0 | 1.21× |
| st3cr_l0.05 | 2.09% | 99.912% | 2.6e-1 / 4.1e+0 | 1.2e+2 / 6.8e+1 / 3.6e+1 / 2.4e+1 | 1.4e-1 | 9.6e+1 | 2.9e-2 | 0.270428 | 2.0e+1 | 4.1e-2 | 2.90× |
| st3cr_l5e-3 | 3.30% | 97.853% | 2.9e-1 / 4.8e+0 | 1.3e-2 / 1.0e-2 / 3.2e-2 / 1.2e-2 | 1.3e-1 | 2.7e-2 | 6.4e-2 | 0.999253 | 9.8e-4 | 1.2e-1 | 1.37× |
| st3cr_l1e-3 | 2.47% | 95.443% | 3.5e-1 / 4.7e+0 | 2.0e-3 / 2.8e-3 / 9.4e-3 / 5.4e-3 | 2.3e-1 | 9.0e-4 | 3.6e-1 | 1.000000 | -2.7e-3 | 9.8e-2 | 1.39× |
| st3cr_l1e-4 | 3.04% | 93.169% | 3.8e-1 / 3.8e+0 | 2.3e-3 / 2.2e-3 / 6.5e-3 / 9.5e-3 | 5.6e-1 | 9.7e-4 | 3.9e+0 | 1.000000 | -2.9e-3 | 8.0e-2 | 1.28× |
| st3cr_l0 | 0.07% | 100.000% | 3.7e-1 / 3.6e+0 | 6.4e-4 / 1.0e-3 / 8.1e-4 / 7.4e-4 | 4.9e-3 | 9.0e-4 | 2.1e-2 | 1.000000 | -3.4e-4 | 0.0e+0 | 2.85× |

Normal budgets passed per scene: kerr_a0_inc17: all; kerr_a0_inc80: all; kerr_a0.94_inc17: all; kerr_a0.94_inc80: all; kerr_a0.998_inc80: all; johannsen_a0.94_a13_5.5: all; mankoNovikov_a0.94_a3_2: all; rn_Q0.8_inc60: all; st3cr_l0.05: emissionL1, emissionP99, flux, lightCurve, chaoticFlux, chaoticFractions; st3cr_l5e-3: emissionL1, emissionP99, flux, classAgreement, chaoticFractions; st3cr_l1e-3: emissionL1, emissionP99, classAgreement, chaoticFractions; st3cr_l1e-4: emissionL1, emissionP99, dt, classAgreement, chaoticFractions; st3cr_l0: all
