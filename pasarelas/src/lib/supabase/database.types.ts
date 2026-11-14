
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "pay_allocations": {
                  Row: {
                    "amount": number,"base": string,"beneficiary_id": string,"created_at": string,"id": string,"is_remainder": boolean,"pct": number,"transaction_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"base": string,"beneficiary_id": string,"created_at"?: string,"id"?: string,"is_remainder"?: boolean,"pct": number,"transaction_id": string,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number,"base"?: string,"beneficiary_id"?: string,"created_at"?: string,"id"?: string,"is_remainder"?: boolean,"pct"?: number,"transaction_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_allocations_beneficiary_id_user_id_fkey"
      columns: ["beneficiary_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_beneficiaries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_allocations_transaction_id_user_id_fkey"
      columns: ["transaction_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_transactions"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_bank_accounts": {
                  Row: {
                    "active": boolean,"alias": string,"created_at": string,"currency": string,"id": string,"institution": string | null,"last4": string | null,"notes": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"alias": string,"created_at"?: string,"currency"?: string,"id"?: string,"institution"?: string | null,"last4"?: string | null,"notes"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "active"?: boolean,"alias"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"institution"?: string | null,"last4"?: string | null,"notes"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pay_beneficiaries": {
                  Row: {
                    "account_alias": string | null,"active": boolean,"created_at": string,"id": string,"kind": string,"name": string,"notes": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_alias"?: string | null,"active"?: boolean,"created_at"?: string,"id"?: string,"kind"?: string,"name": string,"notes"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "account_alias"?: string | null,"active"?: boolean,"created_at"?: string,"id"?: string,"kind"?: string,"name"?: string,"notes"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pay_channels": {
                  Row: {
                    "active": boolean,"company_id": string,"created_at": string,"id": string,"name": string,"platform_fee_fixed": number,"platform_fee_pct": number,"updated_at": string,"url": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"company_id": string,"created_at"?: string,"id"?: string,"name": string,"platform_fee_fixed"?: number,"platform_fee_pct"?: number,"updated_at"?: string,"url"?: string | null,"user_id"?: string
                  }
                  Update: {
                    "active"?: boolean,"company_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"platform_fee_fixed"?: number,"platform_fee_pct"?: number,"updated_at"?: string,"url"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_channels_company_id_user_id_fkey"
      columns: ["company_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_companies"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_companies": {
                  Row: {
                    "active": boolean,"created_at": string,"currency": string,"default_scheme_id": string | null,"id": string,"logo_path": string | null,"name": string,"notes": string | null,"updated_at": string,"user_id": string,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"currency"?: string,"default_scheme_id"?: string | null,"id"?: string,"logo_path"?: string | null,"name": string,"notes"?: string | null,"updated_at"?: string,"user_id"?: string,"website"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"currency"?: string,"default_scheme_id"?: string | null,"id"?: string,"logo_path"?: string | null,"name"?: string,"notes"?: string | null,"updated_at"?: string,"user_id"?: string,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_companies_default_scheme_id_user_id_fkey"
      columns: ["default_scheme_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_schemes"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_company_gateways": {
                  Row: {
                    "active": boolean,"bank_account_id": string | null,"checkout_url": string | null,"company_id": string,"created_at": string,"dashboard_url": string | null,"default_extra_ids": (string)[] | null,"gateway_id": string,"id": string,"payout_days_override": number | null,"payout_days_override_max": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"bank_account_id"?: string | null,"checkout_url"?: string | null,"company_id": string,"created_at"?: string,"dashboard_url"?: string | null,"default_extra_ids"?: (string)[] | null,"gateway_id": string,"id"?: string,"payout_days_override"?: number | null,"payout_days_override_max"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "active"?: boolean,"bank_account_id"?: string | null,"checkout_url"?: string | null,"company_id"?: string,"created_at"?: string,"dashboard_url"?: string | null,"default_extra_ids"?: (string)[] | null,"gateway_id"?: string,"id"?: string,"payout_days_override"?: number | null,"payout_days_override_max"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_company_gateways_bank_account_id_user_id_fkey"
      columns: ["bank_account_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_bank_accounts"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_company_gateways_company_id_user_id_fkey"
      columns: ["company_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_companies"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_company_gateways_gateway_id_user_id_fkey"
      columns: ["gateway_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_gateways"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_gateway_extras": {
                  Row: {
                    "active": boolean,"base": string,"created_at": string,"default_on": boolean,"fixed": number,"gateway_id": string,"id": string,"kind": string,"name": string,"payout_days_override": number | null,"payout_days_override_max": number | null,"pct": number,"sort": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"base"?: string,"created_at"?: string,"default_on"?: boolean,"fixed"?: number,"gateway_id": string,"id"?: string,"kind"?: string,"name": string,"payout_days_override"?: number | null,"payout_days_override_max"?: number | null,"pct"?: number,"sort"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "active"?: boolean,"base"?: string,"created_at"?: string,"default_on"?: boolean,"fixed"?: number,"gateway_id"?: string,"id"?: string,"kind"?: string,"name"?: string,"payout_days_override"?: number | null,"payout_days_override_max"?: number | null,"pct"?: number,"sort"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_gateway_extras_gateway_id_user_id_fkey"
      columns: ["gateway_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_gateways"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_gateway_fee_versions": {
                  Row: {
                    "created_at": string,"effective_from": string,"fixed": number,"gateway_id": string,"id": string,"note": string | null,"pct": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"effective_from"?: string,"fixed": number,"gateway_id": string,"id"?: string,"note"?: string | null,"pct": number,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"effective_from"?: string,"fixed"?: number,"gateway_id"?: string,"id"?: string,"note"?: string | null,"pct"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_gateway_fee_versions_gateway_id_user_id_fkey"
      columns: ["gateway_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_gateways"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_gateway_retention_recipients": {
                  Row: {
                    "beneficiary_id": string,"created_at": string,"gateway_id": string,"id": string,"pct": number,"sort": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "beneficiary_id": string,"created_at"?: string,"gateway_id": string,"id"?: string,"pct": number,"sort"?: number,"user_id"?: string
                  }
                  Update: {
                    "beneficiary_id"?: string,"created_at"?: string,"gateway_id"?: string,"id"?: string,"pct"?: number,"sort"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_gateway_retention_recipients_beneficiary_id_user_id_fkey"
      columns: ["beneficiary_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_beneficiaries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_gateway_retention_recipients_gateway_id_user_id_fkey"
      columns: ["gateway_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_gateways"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_gateways": {
                  Row: {
                    "active": boolean,"created_at": string,"dispute_fee": number,"id": string,"import_mapping": Json | null,"name": string,"notes": string | null,"payout_day_type": string,"payout_days": number,"payout_days_max": number | null,"refunds_return_fee": boolean,"retention_days": number,"retention_pct": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"dispute_fee"?: number,"id"?: string,"import_mapping"?: Json | null,"name": string,"notes"?: string | null,"payout_day_type"?: string,"payout_days"?: number,"payout_days_max"?: number | null,"refunds_return_fee"?: boolean,"retention_days"?: number,"retention_pct"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"dispute_fee"?: number,"id"?: string,"import_mapping"?: Json | null,"name"?: string,"notes"?: string | null,"payout_day_type"?: string,"payout_days"?: number,"payout_days_max"?: number | null,"refunds_return_fee"?: boolean,"retention_days"?: number,"retention_pct"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pay_holidays": {
                  Row: {
                    "created_at": string,"day": string,"id": string,"name": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"day": string,"id"?: string,"name": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"day"?: string,"id"?: string,"name"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pay_retention_shares": {
                  Row: {
                    "amount": number,"beneficiary_id": string,"created_at": string,"id": string,"transaction_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"beneficiary_id": string,"created_at"?: string,"id"?: string,"transaction_id": string,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number,"beneficiary_id"?: string,"created_at"?: string,"id"?: string,"transaction_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_retention_shares_beneficiary_id_user_id_fkey"
      columns: ["beneficiary_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_beneficiaries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_retention_shares_transaction_id_user_id_fkey"
      columns: ["transaction_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_transactions"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_scheme_lines": {
                  Row: {
                    "beneficiary_id": string,"created_at": string,"fee_exempt": boolean,"id": string,"pct": number,"scheme_version_id": string,"sort": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "beneficiary_id": string,"created_at"?: string,"fee_exempt"?: boolean,"id"?: string,"pct": number,"scheme_version_id": string,"sort"?: number,"user_id"?: string
                  }
                  Update: {
                    "beneficiary_id"?: string,"created_at"?: string,"fee_exempt"?: boolean,"id"?: string,"pct"?: number,"scheme_version_id"?: string,"sort"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_scheme_lines_beneficiary_id_user_id_fkey"
      columns: ["beneficiary_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_beneficiaries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_scheme_lines_scheme_version_id_user_id_fkey"
      columns: ["scheme_version_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_scheme_versions"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_scheme_versions": {
                  Row: {
                    "base": string,"created_at": string,"effective_from": string,"id": string,"remainder_beneficiary_id": string | null,"scheme_id": string,"user_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "base"?: string,"created_at"?: string,"effective_from"?: string,"id"?: string,"remainder_beneficiary_id"?: string | null,"scheme_id": string,"user_id"?: string,"version": number
                  }
                  Update: {
                    "base"?: string,"created_at"?: string,"effective_from"?: string,"id"?: string,"remainder_beneficiary_id"?: string | null,"scheme_id"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_scheme_versions_remainder_beneficiary_id_user_id_fkey"
      columns: ["remainder_beneficiary_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_beneficiaries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_scheme_versions_scheme_id_user_id_fkey"
      columns: ["scheme_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_schemes"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_schemes": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"name": string,"notes": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name": string,"notes"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name"?: string,"notes"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pay_settlement_items": {
                  Row: {
                    "amount": number,"beneficiary_id": string,"created_at": string,"id": string,"settlement_id": string,"transaction_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"beneficiary_id": string,"created_at"?: string,"id"?: string,"settlement_id": string,"transaction_id": string,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number,"beneficiary_id"?: string,"created_at"?: string,"id"?: string,"settlement_id"?: string,"transaction_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_settlement_items_settlement_fk"
      columns: ["settlement_id","beneficiary_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_settlements"
      referencedColumns: ["id","beneficiary_id","user_id"]
    },{
      foreignKeyName: "pay_settlement_items_transaction_fk"
      columns: ["transaction_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_transactions"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_settlements": {
                  Row: {
                    "amount": number,"beneficiary_id": string,"created_at": string,"currency": string,"id": string,"method": string | null,"note": string | null,"paid_on": string,"receipt_mime": string | null,"receipt_path": string | null,"receipt_size": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"beneficiary_id": string,"created_at"?: string,"currency"?: string,"id"?: string,"method"?: string | null,"note"?: string | null,"paid_on": string,"receipt_mime"?: string | null,"receipt_path"?: string | null,"receipt_size"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number,"beneficiary_id"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"method"?: string | null,"note"?: string | null,"paid_on"?: string,"receipt_mime"?: string | null,"receipt_path"?: string | null,"receipt_size"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_settlements_beneficiary_id_user_id_fkey"
      columns: ["beneficiary_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_beneficiaries"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_transaction_events": {
                  Row: {
                    "at": string,"data": Json | null,"id": string,"kind": string,"summary": string,"transaction_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"data"?: Json | null,"id"?: string,"kind": string,"summary": string,"transaction_id": string,"user_id"?: string
                  }
                  Update: {
                    "at"?: string,"data"?: Json | null,"id"?: string,"kind"?: string,"summary"?: string,"transaction_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_transaction_events_transaction_id_user_id_fkey"
      columns: ["transaction_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_transactions"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_transaction_receipts": {
                  Row: {
                    "created_at": string,"id": string,"mime": string,"path": string,"size_bytes": number,"transaction_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"mime": string,"path": string,"size_bytes": number,"transaction_id": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"mime"?: string,"path"?: string,"size_bytes"?: number,"transaction_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_transaction_receipts_transaction_id_user_id_fkey"
      columns: ["transaction_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_transactions"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_transactions": {
                  Row: {
                    "alloc_base": string | null,"alloc_base_amount": number,"bank_account_id": string | null,"breakdown": NonNullable<Json>,"buyer_fees": number,"channel_id": string | null,"company_id": string,"created_at": string,"currency": string,"deleted_at": string | null,"deposited_on": string | null,"dispute_closed_on": string | null,"dispute_opened_on": string | null,"dispute_state": string | null,"estimated_deposit_from": string | null,"estimated_deposit_on": string | null,"estimated_is_manual": boolean,"fee_version_id": string,"fees_paid_by": string,"fees_total": number,"gateway_id": string,"gross_amount": number,"gross_original": number,"id": string,"net_amount": number,"note": string | null,"occurred_at": string,"occurred_on": string,"receipts_count": number,"reference": string | null,"refunded_amount": number,"retention_amount": number,"scheme_id": string | null,"scheme_version_id": string | null,"status": string,"updated_at": string,"user_id": string,"pay_payout_pending": boolean | null
                  }
                  ComputedFields: "pay_payout_pending"
                  Insert: {
                    "alloc_base"?: string | null,"alloc_base_amount"?: number,"bank_account_id"?: string | null,"breakdown": NonNullable<Json>,"buyer_fees"?: number,"channel_id"?: string | null,"company_id": string,"created_at"?: string,"currency": string,"deleted_at"?: string | null,"deposited_on"?: string | null,"dispute_closed_on"?: string | null,"dispute_opened_on"?: string | null,"dispute_state"?: string | null,"estimated_deposit_from"?: string | null,"estimated_deposit_on"?: string | null,"estimated_is_manual"?: boolean,"fee_version_id": string,"fees_paid_by"?: string,"fees_total": number,"gateway_id": string,"gross_amount": number,"gross_original": number,"id"?: string,"net_amount": number,"note"?: string | null,"occurred_at": string,"occurred_on": string,"receipts_count"?: number,"reference"?: string | null,"refunded_amount"?: number,"retention_amount"?: number,"scheme_id"?: string | null,"scheme_version_id"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "alloc_base"?: string | null,"alloc_base_amount"?: number,"bank_account_id"?: string | null,"breakdown"?: NonNullable<Json>,"buyer_fees"?: number,"channel_id"?: string | null,"company_id"?: string,"created_at"?: string,"currency"?: string,"deleted_at"?: string | null,"deposited_on"?: string | null,"dispute_closed_on"?: string | null,"dispute_opened_on"?: string | null,"dispute_state"?: string | null,"estimated_deposit_from"?: string | null,"estimated_deposit_on"?: string | null,"estimated_is_manual"?: boolean,"fee_version_id"?: string,"fees_paid_by"?: string,"fees_total"?: number,"gateway_id"?: string,"gross_amount"?: number,"gross_original"?: number,"id"?: string,"net_amount"?: number,"note"?: string | null,"occurred_at"?: string,"occurred_on"?: string,"receipts_count"?: number,"reference"?: string | null,"refunded_amount"?: number,"retention_amount"?: number,"scheme_id"?: string | null,"scheme_version_id"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pay_transactions_bank_account_id_user_id_fkey"
      columns: ["bank_account_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_bank_accounts"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_transactions_channel_id_company_id_user_id_fkey"
      columns: ["channel_id","company_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_channels"
      referencedColumns: ["id","company_id","user_id"]
    },{
      foreignKeyName: "pay_transactions_company_id_user_id_fkey"
      columns: ["company_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_companies"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_transactions_fee_version_id_gateway_id_user_id_fkey"
      columns: ["fee_version_id","gateway_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_gateway_fee_versions"
      referencedColumns: ["id","gateway_id","user_id"]
    },{
      foreignKeyName: "pay_transactions_gateway_id_user_id_fkey"
      columns: ["gateway_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_gateways"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_transactions_scheme_id_user_id_fkey"
      columns: ["scheme_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_schemes"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "pay_transactions_scheme_version_id_scheme_id_user_id_fkey"
      columns: ["scheme_version_id","scheme_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_scheme_versions"
      referencedColumns: ["id","scheme_id","user_id"]
    }
                  ]
                }
          }
          Views: {
            "pay_bank_account_totals": {
                  Row: {
                    "avg_days": number | null,"bank_account_id": string | null,"currency": string,"deposited_count": number | null,"deposited_net": number | null,"deposited_payout": number | null,"median_days": number | null,"pending_count": number | null,"pending_net": number | null,"pending_payout": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "pay_transactions_bank_account_id_user_id_fkey"
      columns: ["bank_account_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_bank_accounts"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_beneficiary_balances": {
                  Row: {
                    "assigned": number | null,"balance": number | null,"beneficiary_id": string | null,"currency": string | null,"retained": number | null,"settled": number | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"pay_company_totals": {
                  Row: {
                    "buyer_fees": number | null,"company_id": string,"currency": string,"fees": number | null,"first_on": string | null,"gross": number | null,"last_on": string | null,"net": number | null,"retention": number | null,"tx_count": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "pay_transactions_company_id_user_id_fkey"
      columns: ["company_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_companies"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"pay_gateway_totals": {
                  Row: {
                    "avg_days": number | null,"buyer_fees": number | null,"currency": string,"deposited_count": number | null,"fees": number | null,"gateway_id": string,"gross": number | null,"median_days": number | null,"net": number | null,"retention": number | null,"tx_count": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "pay_transactions_gateway_id_user_id_fkey"
      columns: ["gateway_id","user_id"]
isOneToOne: false
      referencedRelation: "pay_gateways"
      referencedColumns: ["id","user_id"]
    }
                  ]
                }
          }
          Functions: {
            "pay_create_gateway":
{ Args: { "p": Json }; Returns: string
                           },
"pay_payout_pending":
{ Args: { "t": Omit<Database["public"]['Tables']["pay_transactions"]['Row'], Database["public"]['Tables']["pay_transactions"]['ComputedFields']> }; Returns: boolean
                           },
"pay_record_payouts":
{ Args: { "p": Json }; Returns: Json
                           },
"pay_save_gateway_retention":
{ Args: { "p": Json }; Returns: undefined
                           },
"pay_save_scheme":
{ Args: { "p": Json }; Returns: Json
                           },
"pay_save_transactions":
{ Args: { "p_items": Json,"p_skip_duplicates"?: boolean }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
