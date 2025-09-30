import crypto from 'crypto';

export class EncryptionService {
    private key: Buffer;
    private iv: Buffer;

    constructor(encryptionKey: string, iv: string) {
        this.key = this.generateKey(encryptionKey);
        this.iv = Buffer.from(iv, 'utf8');

        // Validate IV length (must be 16 bytes for AES)
        if (this.iv.length !== 16) {
            throw new Error('IV must be exactly 16 bytes (128 bits)');
        }
    }

    // Generate a 256-bit key from any input string (matches Flutter implementation)
    private generateKey(input: string): Buffer {
        return crypto.createHash('sha256').update(input, 'utf8').digest();
    }

    // Main encryption method - handles different data types
    encryptData(data: any): any {
        if (typeof data === 'string') {
            return this.encryptString(data);
        } else if (Array.isArray(data)) {
            return data.map(item => this.encryptData(item));
        } else if (data && typeof data === 'object') {
            return this.encryptMap(data);
        } else {
            return this.encryptString(JSON.stringify(data));
        }
    }

    // Main decryption method - handles different data types
    decryptData(data: any): any {
        if (typeof data === 'string') {
            return this.decryptString(data);
        } else if (Array.isArray(data)) {
            return data.map(item => this.decryptData(item));
        } else if (data && typeof data === 'object') {
            return this.decryptMap(data);
        } else {
            try {
                return JSON.parse(this.decryptData(data));
            } catch {
                return data;
            }
        }
    }

    // Encrypt a string
    private encryptString(text: string): string {
        const cipher = crypto.createCipheriv('aes-256-cbc', Uint8Array.from(this.key), Uint8Array.from(this.iv));
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return encrypted;
    }

    // Decrypt a string
    private decryptString(encryptedText: string): string {
        try {
            const decipher = crypto.createDecipheriv('aes-256-cbc', Uint8Array.from(this.key), Uint8Array.from(this.iv));
            let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            // If we can't decrypt it, return the original (matches Flutter behavior)
            return encryptedText;
        }
    }

    // Encrypt a map/object
    private encryptMap(map: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(map)) {
            if (typeof value === 'string') {
                result[key] = this.encryptString(value);
            } else {
                result[key] = this.encryptData(value);
            }
        }
        return result;
    }

    // Helper function to parse decrypted values back to their original types
    private parseDecryptedValue(value: string): any {
        // Try to parse as number
        if (/^-?\d+$/.test(value)) {
            // Integer
            const num = parseInt(value, 10);
            if (!isNaN(num)) return num;
        } else if (/^-?\d*\.\d+$/.test(value)) {
            // Float
            const num = parseFloat(value);
            if (!isNaN(num)) return num;
        }
        
        // Try to parse as boolean
        if (value === 'true') return true;
        if (value === 'false') return false;
        
        // Try to parse as null
        if (value === 'null') return null;
        
        // Return as string if no other type matches
        return value;
    }

    // Decrypt a map/object
    private decryptMap(map: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(map)) {
            if (typeof value === 'string') {
                try {
                    const decrypted = this.decryptString(value);
                    // Parse the decrypted value back to its original type
                    const parsed = this.parseDecryptedValue(decrypted);
                    result[key] = parsed;
                } catch {
                    result[key] = value;
                }
            } else {
                result[key] = this.decryptData(value);
            }
        }
        return result;
    }

    // Get the current IV as base64 string
    getIVBase64(): string {
        return this.iv.toString('base64');
    }

    // Static factory method to create instance with base64 IV
    static withIV(encryptionKey: string, ivBase64: string): EncryptionService {
        const iv = Buffer.from(ivBase64, 'base64');

        if (iv.length !== 16) {
            throw new Error('IV must be exactly 16 bytes (128 bits)');
        }

        // Convert buffer back to string for constructor
        const ivString = iv.toString('binary');
        return new EncryptionService(encryptionKey, ivString);
    }
}

// Middleware function to handle encryption/decryption based on headers
export function createEncryptionMiddleware(encryptionKey: string, iv: string) {
    const encryptionService = new EncryptionService(encryptionKey, iv);

    return {
        // Process request data (decrypt if needed)
        processRequest: (data: any, headers: Record<string, string | string[] | undefined>): any => {
            const isEncrypted = headers['is_encrypted'] || headers['IS_ENCRYPTED'] || headers['Is-Encrypted'];

            if (isEncrypted === 'YES' || isEncrypted === 'yes' || isEncrypted === 'true') {
                console.log('[Encryption] Decrypting incoming request data');
                return encryptionService.decryptData(data);
            }

            return data;
        },

        // Process response data (encrypt if needed)
        processResponse: (data: any, headers: Record<string, string | string[] | undefined>): any => {
            const isEncrypted = headers['is_encrypted'] || headers['IS_ENCRYPTED'] || headers['Is-Encrypted'];

            if (isEncrypted === 'YES' || isEncrypted === 'yes' || isEncrypted === 'true') {
                console.log('[Encryption] Encrypting outgoing response data');
                return encryptionService.encryptData(data);
            }

            return data;
        },

        // Get the encryption service instance
        getService: () => encryptionService
    };
}