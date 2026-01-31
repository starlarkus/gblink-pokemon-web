
import { GSCChecks } from './GSCChecks.js';
import { RSESPUtils } from './RSESPUtils.js';

export class RSESPChecks extends GSCChecks {
    constructor(doSanityChecks = true) {
        // Section sizes for Gen 3: [0x380] (896 bytes) for the whole block usually,
        // but here we might need to conform to what TradingProtocol expects.
        // RSESPTrading.py defines special_sections_len = [0x380].
        super(doSanityChecks);
        this.sectionSizes = [0x380];
        this.utilsClass = RSESPUtils;
    }

    // Override cleanSpecies for Gen 3 specifics
    cleanSpecies(species) {
        // Basic check for now
        if (species > this.utilsClass.last_valid_pokemon) {
            return 0; // MissingNo/Invalid
        }
        return species;
    }

    // Checking if it is an egg in Gen 3 is different (bit in misc structure)
    // We'll need access to the PokemonInfo object for that.
    isEgg(mon) {
        // Python: if (self.misc[7] & 0x40) != 0
        if (mon && mon.misc) {
            return (mon.misc[7] & 0x40) !== 0;
        }
        return false;
    }
}
