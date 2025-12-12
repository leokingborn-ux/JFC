// Heuristic analysis utilities for Artemis Native

interface AnalysisResult {
  score: number; // 0-100 (100 = Very Hard/Secure, 0 = Broken/Trivial)
  label: 'Critical' | 'Vulnerable' | 'Weak' | 'Standard' | 'Hardened';
  derivationDifficulty: 'Impossible' | 'Exponential' | 'Polynomial' | 'Trivial';
  vectors: string[]; // Specific vulnerability vectors found
  warnings: string[];
}

export const analyzeTargetAddress = (address: string): AnalysisResult => {
  const warnings: string[] = [];
  const vectors: string[] = [];
  let score = 100;
  let derivationDifficulty: AnalysisResult['derivationDifficulty'] = 'Exponential';

  if (!address || address.length < 42 || !address.startsWith('0x')) {
    return { 
        score: 0, 
        label: 'Critical', 
        derivationDifficulty: 'Trivial',
        vectors: ['Format Error'], 
        warnings: ['Invalid Ethereum address format'] 
    };
  }

  const cleanAddr = address.toLowerCase();

  // 1. PRECOMPILED CONTRACTS CHECK (Impossible to derive)
  if (cleanAddr.startsWith('0x000000000000000000000000000000000000000')) {
      const lastDigit = parseInt(cleanAddr[cleanAddr.length - 1], 16);
      if (lastDigit >= 0 && lastDigit <= 9) {
          return {
              score: 100,
              label: 'Hardened',
              derivationDifficulty: 'Impossible',
              vectors: [],
              warnings: ['Address is an EVM Precompiled Contract. No private key exists.']
          };
      }
  }

  // 2. NULL / BURN ADDRESS CHECK
  if (cleanAddr === '0x0000000000000000000000000000000000000000') {
      return {
          score: 100,
          label: 'Hardened',
          derivationDifficulty: 'Impossible',
          vectors: [],
          warnings: ['Null Address (Genesis). No known private key.']
      };
  }

  // 3. PROFANITY VULNERABILITY DETECTION
  // The 'Profanity' tool used a 32-bit seed. Addresses with long vanity prefixes (>7 chars)
  // created before late 2022 are highly likely to be vulnerable.
  const vanityMatch = cleanAddr.substring(2).match(/^([0-9a-f])\1{6,}/) || // 7+ repeating chars
                      cleanAddr.substring(2).match(/^(00000000)/) ||      // 8+ leading zeros
                      cleanAddr.substring(2).match(/^(dead|beef|cafe|babe|ace|bad){2,}/); // Recurring hexspeak

  if (vanityMatch) {
      score -= 50;
      vectors.push('Weak Entropy Seeding (Profanity-style)');
      derivationDifficulty = 'Polynomial'; // Theoretically crackable with GPU clusters
      warnings.push(`High Vanity Detected (${vanityMatch[0]}...). High probability of weak seed generation.`);
  }

  // 4. CREATE2 FACTORY PATTERN (Gas Optimization)
  if (cleanAddr.startsWith('0x00000000')) {
      score -= 10;
      vectors.push('Gas Optimized / Proxy Pattern');
      warnings.push('Address structure suggests a Smart Contract Proxy (CREATE2), not a user wallet.');
  }

  // 5. CHECKSUM VALIDATION
  const isMixedCase = /[a-f]/.test(address) && /[A-F]/.test(address);
  if (!isMixedCase && score > 50) {
    warnings.push('Address is not checksummed. Ensure this is the correct target.');
  }

  // 6. ENTROPY DENSITY CHECK
  const entropy = calculateEntropyScore(cleanAddr.substring(2));
  if (entropy < 85) {
      score -= 20;
      vectors.push('Low Entropy Artifacts');
      warnings.push('Address exhibits statistical anomalies suggesting non-random generation.');
  }
  
  // BIP39 Confirmation Note
  if (vectors.length === 0) {
      warnings.push('Standard BIP-39 derivation assumed. Engine will adaptively test 12/24 word seeds.');
  }

  // Final Labeling
  let label: AnalysisResult['label'] = 'Standard';
  if (score < 30) label = 'Critical';
  else if (score < 60) label = 'Vulnerable';
  else if (score < 80) label = 'Weak';
  else if (score >= 95) label = 'Hardened';

  return { score, label, derivationDifficulty, vectors, warnings };
};

export const calculateEntropyScore = (hexString: string): number => {
  // Simple Shannon entropy estimation
  const len = hexString.length;
  const frequencies: Record<string, number> = {};
  for (let i = 0; i < len; i++) {
    const char = hexString[i];
    frequencies[char] = (frequencies[char] || 0) + 1;
  }

  let entropy = 0;
  for (const char in frequencies) {
    const p = frequencies[char] / len;
    entropy -= p * Math.log2(p);
  }
  
  // Max entropy for hex (base 16) is 4. Map 0-4 to 0-100.
  return Math.min(100, (entropy / 4) * 100);
};

// --- Sophisticated Analysis Tools ---

export const calculateHammingDistance = (str1: string, str2: string): number => {
    if (str1.length !== str2.length) return Math.max(str1.length, str2.length);
    let distance = 0;
    for (let i = 0; i < str1.length; i++) {
        if (str1[i].toLowerCase() !== str2[i].toLowerCase()) {
            distance++;
        }
    }
    return distance;
};

export const analyzeNgrams = (text: string, n: number = 2): Record<string, number> => {
    const grams: Record<string, number> = {};
    for (let i = 0; i < text.length - n + 1; i++) {
        const gram = text.substring(i, i + n);
        grams[gram] = (grams[gram] || 0) + 1;
    }
    return grams;
};

export const calculateHexDistance = (hex1: string, hex2: string) => {
    // Byte-level Hamming distance and a simple Levenshtein for hex strings
    try {
        const b1 = Buffer.from(hex1.replace(/^0x/, ''), 'hex');
        const b2 = Buffer.from(hex2.replace(/^0x/, ''), 'hex');
        const len = Math.min(b1.length, b2.length);
        let byteHamming = 0;
        for (let i = 0; i < len; i++) if (b1[i] !== b2[i]) byteHamming++;
        byteHamming += Math.abs(b1.length - b2.length);

        // Simple Levenshtein on hex characters
        const s1 = hex1.replace(/^0x/, '');
        const s2 = hex2.replace(/^0x/, '');
        const dp: number[][] = Array.from({ length: s1.length + 1 }, () => new Array(s2.length + 1).fill(0));
        for (let i = 0; i <= s1.length; i++) dp[i][0] = i;
        for (let j = 0; j <= s2.length; j++) dp[0][j] = j;
        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
            }
        }

        return { byteHamming, levenshtein: dp[s1.length][s2.length] };
    } catch (e) {
        return { byteHamming: Infinity, levenshtein: Infinity };
    }
};

export const analyzeMnemonicStrength = (mnemonic: string) => {
    const words = mnemonic.split(/\s+/).filter(Boolean);
    const unique = new Set(words).size;
    const bigrams: Record<string, number> = {};
    for (let i = 0; i < words.length - 1; i++) {
        const g = words[i] + ' ' + words[i + 1];
        bigrams[g] = (bigrams[g] || 0) + 1;
    }

    // Score heuristic: higher uniqueness and fewer repeating bigrams -> stronger
    const uniquenessScore = (unique / words.length) * 100;
    const repeatPenalty = Object.values(bigrams).reduce((acc, v) => acc + (v > 1 ? v - 1 : 0), 0);

    return {
        words,
        uniquenessScore: Math.round(uniquenessScore),
        repeatPenalty,
        overall: Math.max(0, Math.min(100, Math.round(uniquenessScore - repeatPenalty * 5)))
    };
};