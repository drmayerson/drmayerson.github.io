# Quality gate: bs3_tol0.3 vs Reference (512², code 48a078bd6a71)

High with the Bogacki-Shampine 3(2) integrator, tolerance 0.3 pixel angles, steps capped at 4x FOORT's rule.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 99.996% | 1.1e-2 / 1.1e-1 | 3.3e-4 / 4.4e-3 / 4.0e-3 / 3.4e-3 | 1.5e-2 | 5.4e-4 | 3.7e-1 | 0.999997 | -7.9e-4 | 0.0e+0 | 1.65× |
| kerr_a0_inc80 | 0.00% | 99.995% | 1.1e-2 / 1.1e-1 | 8.9e-4 / 4.2e-3 / 4.8e-3 / 4.1e-3 | 1.4e-2 | 1.6e-3 | 6.0e-2 | 0.999984 | -4.1e-4 | 0.0e+0 | 2.09× |
| kerr_a0.94_inc17 | 0.00% | 99.998% | 1.5e-2 / 1.2e-1 | 3.4e-4 / 4.3e-3 / 4.5e-3 / 3.6e-3 | 1.7e-2 | 5.0e-4 | 3.1e-1 | 0.999997 | 4.5e-4 | 0.0e+0 | 1.30× |
| kerr_a0.94_inc80 | 0.01% | 99.999% | 1.4e-2 / 1.6e-1 | 6.6e-4 / 4.1e-3 / 4.8e-3 / 4.6e-3 | 1.4e-2 | 8.8e-4 | 6.1e-2 | 0.999992 | -1.2e-4 | 0.0e+0 | 1.76× |
| kerr_a0.998_inc80 | 0.02% | 99.999% | 1.4e-2 / 1.7e-1 | 6.7e-4 / 4.1e-3 / 4.9e-3 / 4.7e-3 | 1.5e-2 | 8.4e-4 | 6.8e-2 | 0.999992 | 2.5e-4 | 0.0e+0 | 1.79× |
| johannsen_a0.94_a13_5.5 | 0.00% | 99.999% | 1.3e-2 / 1.2e-1 | 3.8e-4 / 4.4e-3 / 4.4e-3 / 3.6e-3 | 1.5e-2 | 5.7e-4 | 5.2e-1 | 0.999997 | 9.9e-4 | 0.0e+0 | 3.60× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.997% | 1.5e-2 / 1.4e-1 | 4.0e-4 / 4.1e-3 / 5.1e-3 / 3.7e-3 | 1.7e-2 | 6.2e-4 | 3.4e-1 | 0.999995 | 4.3e-4 | 3.7e-2 | 3.13× |
| rn_Q0.8_inc60 | 0.01% | 100.000% | 1.3e-2 / 1.2e-1 | 6.1e-4 / 3.7e-3 / 4.2e-3 / 3.6e-3 | 1.4e-2 | 1.1e-3 | 2.6e-1 | 0.999993 | 3.7e-3 | 1.4e-1 | 1.43× |
| st3cr_l0.05 | 2.09% | 99.927% | 2.8e-1 / 4.7e+0 | 1.3e+1 / 5.6e+0 / 9.3e+0 / 3.5e+1 | 2.7e-1 | 2.9e+1 | 4.4e-2 | 0.153224 | 6.9e+1 | 1.6e-2 | 3.51× |
| st3cr_l5e-3 | 3.30% | 97.574% | 3.1e-1 / 5.4e+0 | 2.1e-3 / 2.1e-3 / 6.0e-3 / 6.0e-3 | 3.7e-1 | 7.7e-4 | 1.5e-1 | 1.000000 | 1.9e-3 | 1.1e-1 | 1.98× |
| st3cr_l1e-3 | 2.47% | 94.917% | 3.5e-1 / 4.9e+0 | 2.4e-3 / 3.1e-3 / 1.1e-2 / 6.3e-3 | 3.1e-1 | 9.9e-4 | 7.9e-1 | 1.000000 | -4.3e-3 | 1.0e-1 | 1.64× |
| st3cr_l1e-4 | 3.04% | 92.986% | 3.8e-1 / 3.8e+0 | 2.4e-3 / 2.3e-3 / 6.8e-3 / 9.7e-3 | 5.9e-1 | 9.5e-4 | 8.0e+0 | 1.000000 | -2.9e-3 | 7.7e-2 | 1.13× |
| st3cr_l0 | 0.07% | 100.000% | 3.7e-1 / 3.6e+0 | 6.4e-4 / 1.0e-3 / 8.1e-4 / 7.4e-4 | 4.9e-3 | 9.0e-4 | 2.1e-2 | 1.000000 | -3.4e-4 | 0.0e+0 | 3.04× |

Normal budgets passed per scene: kerr_a0_inc17: emissionL1; kerr_a0_inc80: emissionL1; kerr_a0.94_inc17: emissionL1; kerr_a0.94_inc80: emissionL1; kerr_a0.998_inc80: emissionL1; johannsen_a0.94_a13_5.5: emissionL1, dt; mankoNovikov_a0.94_a3_2: emissionL1; rn_Q0.8_inc60: emissionL1; st3cr_l0.05: emissionL1, emissionP99, flux, lightCurve, chaoticFlux, chaoticFractions; st3cr_l5e-3: emissionL1, emissionP99, classAgreement, chaoticFractions; st3cr_l1e-3: emissionL1, emissionP99, dt, classAgreement, chaoticFractions; st3cr_l1e-4: emissionL1, emissionP99, dt, classAgreement, chaoticFractions; st3cr_l0: all
