import { Document, Types } from "mongoose";

declare global {
  namespace Express {
    interface Request {
      file?: any;
    }
  }
}

export interface ICommissionAudit {
  /** Commission amount (₹) at time of sale */
  originalCommission: number;
  /** Rate used (e.g. 0.3 for 30%) */
  commissionRate: number;
  /** Gross line value (price × quantity) */
  lineGross: number;
  /** "ACTIVE" while order is live, "CANCELLED_COMMISSION_REVERSED" after item is cancelled */
  status: "ACTIVE" | "CANCELLED_COMMISSION_REVERSED";
  /** ISO timestamp when commission was reversed (only set on cancellation) */
  reversedAt?: Date;
}

export interface IItemClaim {
  isClaimed: boolean;
  claimType: "Replacement" | "Refund";
  reason: string;
  proofUrl: string;
  status: "Pending" | "Approved" | "Rejected";
  claimedAt: Date;
}

export interface IRefundDetails {
  refundId?: string;
  refundStatus?: "PENDING" | "PROCESSED" | "FAILED" | "PENDING_MANUAL_REVIEW";
  refundAmount?: number;
  refundedAt?: Date;
  reason?: string;
  failureReason?: string;
}

export interface IOrderItem {
  _id?: Types.ObjectId | any;
  itemModel:
    | "Product"
    | "Plant"
    | "Pot"
    | "Accessory"
    | "GardeningTool"
    | "PlantCare"
    | "SeedsBulbs"
    | "PlantStandsShelves"
    | "ArtificialDriedPlant"
    | string;
  item: Types.ObjectId | any; // Generic field supporting any item type
  quantity: number;
  price: number;
  priceAtPurchase: number; // Snapshot of the effective price paid at purchase time
  originalPrice?: number; // Catalog MRP at time of purchase
  discountPrice?: number; // Discount price if applicable
  taxAmount?: number; // Snapshot of calculated GST for this item
  taxRatePercentage?: number; // Snapshot of category GST percentage at purchase
  taxCategory?: string; // Snapshot of category name
  isTaxInclusive?: boolean; // Snapshot of tax inclusion configuration
  commissionRatePercentage?: number; // Snapshot of commission percentage at purchase
  commissionAmount?: number; // Snapshot of calculated commission amount
  nurseryEarnings?: number; // Snapshot of nursery net share (gross - commission)
  nursery: Types.ObjectId;
  status: "Processing" | "Shipped" | "Out for Delivery" | "Delivered" | "Cancelled" | "Claimed";
  claim?: IItemClaim;
  refundDetails?: IRefundDetails;
  commissionAudit?: ICommissionAudit;
}

export interface IOrder extends Document {
  shippingInfo: {
    name: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    country: string;
    pinCode: string;
  };
  orderItems: IOrderItem[];
  user: Types.ObjectId;
  paymentInfo: {
    id: string;
    orderId: string;
    status: string;
  };
  itemsPrice: number;
  taxPrice: number;
  shippingPrice: number;
  couponCode?: string;
  discountAmount?: number;
  totalPrice: number;
  orderStatus: "Processing" | "Shipped" | "Out for Delivery" | "Delivered" | "Cancelled";
  refundDetails?: IRefundDetails;
  paidAt: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
