/**
 * The art seed is a fixed constant, never the run seed.
 *
 * Art must be byte-identical on every machine and across every run — that is what
 * makes "regenerate twice and diff the PNGs" a meaningful determinism check, and
 * what lets a critic compare two captures without art drift as a confound.
 */
export const ART_SEED = 0x414c445a; // 'ALDZ'
