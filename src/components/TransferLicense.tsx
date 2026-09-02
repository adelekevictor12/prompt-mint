import { useState, useCallback } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { useNetworkState } from '@/hooks/useNetworkState';
import { PromptHashClient } from '@/lib/stellar/promptHashClient';
import { detectNetworkMismatch } from '@/lib/wallet/networkDetection';
import { isValidStellarAddress, shortenAddress } from '@/lib/stellar/addressValidation';
import { useAsyncTransaction } from '@/components/useAsyncTransaction';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Send,
    AlertTriangle,
    CheckCircle2,
    X,
    Loader2,
    ShieldCheck,
    ArrowRight,
    Info,
    AlertCircle,
} from 'lucide-react';

const promptImageFallback = '/images/codeguru.png';

function formatPrice(stroops: bigint): string {
    const xlm = Number(stroops) / 10_000_000;
    return `${xlm.toLocaleString('en-US', { maximumFractionDigits: 7 })} XLM`;
}

export interface TransferLicenseData {
    id: string;
    title: string;
    priceStroops: bigint;
    imageUrl: string;
    category: string;
    creator: string;
    previewText: string;
}

type TransferStep = 'input' | 'review' | 'signing' | 'complete' | 'error';

interface TransferLicenseProps {
    prompt: TransferLicenseData;
    onClose: () => void;
    onSuccess?: () => void;
}

export function TransferLicense({ prompt, onClose, onSuccess }: TransferLicenseProps) {
    const { address } = useWallet();
    const networkState = useNetworkState();

    const [step, setStep] = useState<TransferStep>('input');
    const [recipientAddress, setRecipientAddress] = useState('');
    const [recipientError, setRecipientError] = useState<string | null>(null);
    const [priceStroops, setPriceStroops] = useState('');
    const [priceError, setPriceError] = useState<string | null>(null);
    const [isTransferToSelf, setIsTransferToSelf] = useState(false);
    const [confirmationChecked, setConfirmationChecked] = useState(false);
    const [txHash, setTxHash] = useState<string | null>(null);

    const validateRecipient = useCallback((value: string) => {
        setRecipientAddress(value);
        setRecipientError(null);
        setIsTransferToSelf(false);

        if (!value) {
            return;
        }

        if (value === address) {
            setIsTransferToSelf(true);
            setRecipientError('You cannot transfer a license to yourself');
            return;
        }

        if (!isValidStellarAddress(value)) {
            setRecipientError('Invalid Stellar address format');
            return;
        }
    }, [address]);

    const validatePrice = useCallback((value: string) => {
        setPriceStroops(value);
        setPriceError(null);

        if (!value) {
            return;
        }

        try {
            const amount = BigInt(value);
            if (amount < 0n) {
                setPriceError('Price cannot be negative');
                return;
            }
        } catch {
            setPriceError('Please enter a valid number');
            return;
        }
    }, []);

    const { execute: runTransfer, isLoading: isTransferring, error: transferError } = useAsyncTransaction(
        async () => {
            if (!address) throw new Error('Wallet not connected');
            if (!recipientAddress) throw new Error('Recipient address required');
            if (!isValidStellarAddress(recipientAddress)) throw new Error('Invalid recipient address');
            if (recipientAddress === address) throw new Error('Cannot transfer to yourself');
            if (!priceStroops) throw new Error('Price required');

            const walletNetworkState = detectNetworkMismatch(
                !!address,
                undefined,
                'connected'
            );
            if (walletNetworkState.type === 'wrong-network') {
                throw new Error(walletNetworkState.message || 'Wrong network connected');
            }

            if (!networkState.canTrustConfirmation) {
                throw new Error('Network connection lost or degraded');
            }

            setStep('signing');

            const result = await PromptHashClient.transferLicense(
                prompt.id,
                address,
                recipientAddress,
                BigInt(priceStroops),
            );

            setTxHash(result.txHash);
            return result;
        },
        {
            onOptimistic: () => setStep('signing'),
            onSuccess: () => {
                setStep('complete');
                onSuccess?.();
            },
            onError: () => setStep('error'),
        },
    );

    const handleReview = () => {
        if (!recipientAddress || !isValidStellarAddress(recipientAddress) || recipientAddress === address) {
            return;
        }
        if (!priceStroops) {
            setPriceError('Price is required');
            return;
        }
        setStep('review');
    };

    const handleConfirm = () => {
        if (!confirmationChecked) return;
        runTransfer().catch(() => { });
    };

    const handleBack = () => {
        if (step === 'review') {
            setStep('input');
            setConfirmationChecked(false);
        }
    };

    const handleRetry = () => {
        setStep('review');
    };

    const handleClose = () => {
        onClose();
    };

    const isFormValid =
        recipientAddress &&
        isValidStellarAddress(recipientAddress) &&
        recipientAddress !== address &&
        priceStroops &&
        !priceError;
    const canConfirm = isFormValid && confirmationChecked && !isTransferring;

    return (
        <div className="p-5 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Send className="h-5 w-5 text-blue-400" />
                    <h2 className="text-lg font-semibold text-white">Transfer License</h2>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                    onClick={handleClose}
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Prompt summary */}
            <div className="flex gap-3 p-3 rounded-xl border border-white/10 bg-[#0f1419]">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg">
                    <img
                        src={prompt.imageUrl || promptImageFallback}
                        alt={prompt.title}
                        className="h-full w-full object-cover"
                    />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-white truncate">{prompt.title}</h3>
                    <div className="mt-1 flex items-center gap-2">
                        <Badge className="border-white/10 bg-white/[0.04] text-slate-300 text-[10px]">
                            {prompt.category}
                        </Badge>
                        <span className="text-xs font-semibold text-white">{formatPrice(prompt.priceStroops)}</span>
                    </div>
                </div>
            </div>

            {/* Step: Input */}
            {step === 'input' && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-white">Recipient Stellar Address</label>
                        <input
                            type="text"
                            value={recipientAddress}
                            onChange={(e) => validateRecipient(e.target.value)}
                            placeholder="G..."
                            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            disabled={isTransferring}
                        />
                        {recipientError && (
                            <p className="text-xs text-red-400">{recipientError}</p>
                        )}
                        {isTransferToSelf && (
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                                <p className="text-xs text-amber-300">
                                    You cannot transfer a license to yourself. Please enter a different address.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-white">Transfer Price (XLM)</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={priceStroops ? (Number(priceStroops) / 10_000_000).toString() : ''}
                                onChange={(e) => {
                                    const xlm = e.target.value;
                                    if (xlm === '') {
                                        setPriceStroops('');
                                        setPriceError(null);
                                    } else {
                                        try {
                                            const stroops = BigInt(Math.floor(Number(xlm) * 10_000_000)).toString();
                                            validatePrice(stroops);
                                        } catch {
                                            setPriceError('Please enter a valid number');
                                        }
                                    }
                                }}
                                placeholder="0.00"
                                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                disabled={isTransferring}
                            />
                        </div>
                        {priceError && (
                            <p className="text-xs text-red-400">{priceError}</p>
                        )}
                    </div>

                    <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                        <div className="flex items-start gap-2">
                            <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                            <div className="text-xs text-blue-300 space-y-1">
                                <p>The recipient will receive a permanent license for this prompt.</p>
                                <p>You will receive the transfer price you set. After confirmation, you will lose access to this prompt.</p>
                            </div>
                        </div>
                    </div>

                    <Button
                        className="w-full h-11 bg-blue-500 text-white hover:bg-blue-400"
                        onClick={handleReview}
                        disabled={!isFormValid}
                    >
                        Review Transfer
                        <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                </div>
            )}

            {/* Step: Review */}
            {step === 'review' && (
                <div className="space-y-4">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                            <span className="text-sm text-slate-400">Recipient</span>
                            <span className="text-sm font-mono text-white">{shortenAddress(recipientAddress)}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                            <span className="text-sm text-slate-400">Listing</span>
                            <span className="text-sm text-white truncate max-w-[200px]">{prompt.title}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                            <span className="text-sm text-slate-400">Transfer Price</span>
                            <span className="text-sm font-semibold text-white">{formatPrice(BigInt(priceStroops))}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                            <span className="text-sm text-slate-400">Your Access</span>
                            <span className="text-sm text-red-400 font-semibold">Will be removed</span>
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
                            <div>
                                <h4 className="text-sm font-semibold text-red-300">Important Consequences</h4>
                                <ul className="mt-2 space-y-1 text-xs text-red-200">
                                    <li>• You will LOSE permanent access to this prompt and its content</li>
                                    <li>• You cannot undo this transfer once confirmed</li>
                                    <li>• The recipient will receive the license and can access the prompt</li>
                                    <li>• You will receive the specified transfer price in your wallet</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
                            <div>
                                <h4 className="text-sm font-semibold text-amber-300">Verification</h4>
                                <ul className="mt-2 space-y-1 text-xs text-amber-200">
                                    <li>• Recipient address is valid on the Stellar network</li>
                                    <li>• The recipient cannot already own this prompt</li>
                                    <li>• The transfer cannot be reversed after signing</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={confirmationChecked}
                            onChange={(e) => setConfirmationChecked(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/50"
                            disabled={isTransferring}
                        />
                        <span className="text-sm text-slate-300">
                            I understand I will permanently lose access to this prompt and this transfer cannot be reversed
                        </span>
                    </label>

                    {transferError && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                            <p className="text-sm text-red-300">{transferError.message}</p>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            className="flex-1 h-11 border-white/15 bg-white/[0.03] text-white hover:bg-white/10"
                            onClick={handleBack}
                            disabled={isTransferring}
                        >
                            Back
                        </Button>
                        <Button
                            className="flex-1 h-11 bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-50"
                            onClick={handleConfirm}
                            disabled={!canConfirm}
                        >
                            {isTransferring ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Send className="h-4 w-4 mr-2" />
                                    Confirm Transfer
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            )}

            {/* Step: Signing */}
            {step === 'signing' && (
                <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center">
                    <div className="relative">
                        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                        <div className="absolute inset-0 blur-xl bg-blue-500/20" />
                    </div>
                    <div>
                        <p className="text-slate-200 font-bold text-lg">Confirming in Wallet...</p>
                        <p className="text-sm text-slate-400 mt-2">
                            Please confirm the transaction in your wallet
                        </p>
                    </div>
                </div>
            )}

            {/* Step: Complete */}
            {step === 'complete' && (
                <div className="space-y-4">
                    <div className="text-center">
                        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
                        <h3 className="mt-4 text-lg font-semibold text-white">Transfer Completed!</h3>
                        <p className="mt-2 text-sm text-slate-400">
                            License transferred to {shortenAddress(recipientAddress)}
                        </p>
                    </div>

                    <div className="p-3 rounded-lg bg-white/5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-400">Transaction</span>
                            <span className="text-xs font-mono text-slate-300">{shortenAddress(txHash || '', 12, 8)}</span>
                        </div>
                    </div>

                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <div className="flex items-start gap-2">
                            <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                            <div className="text-xs text-emerald-300">
                                <p>The recipient now owns the license to this prompt.</p>
                                <p className="mt-1">You have received the transfer price in your wallet.</p>
                                <p className="mt-1">This prompt has been removed from your library.</p>
                            </div>
                        </div>
                    </div>

                    <Button
                        className="w-full h-11 bg-cyan-200 text-slate-950 hover:bg-cyan-100"
                        onClick={handleClose}
                    >
                        Done
                    </Button>
                </div>
            )}

            {/* Step: Error */}
            {step === 'error' && (
                <div className="space-y-4">
                    <div className="text-center">
                        <AlertTriangle className="mx-auto h-12 w-12 text-red-400" />
                        <h3 className="mt-4 text-lg font-semibold text-white">Transfer Failed</h3>
                        <p className="mt-2 text-sm text-slate-400">
                            {transferError?.message || 'An error occurred while processing the transfer'}
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            className="flex-1 h-11 border-white/15 bg-white/[0.03] text-white hover:bg-white/10"
                            onClick={handleClose}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="flex-1 h-11 bg-blue-500 text-white hover:bg-blue-400"
                            onClick={handleRetry}
                        >
                            Try Again
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
