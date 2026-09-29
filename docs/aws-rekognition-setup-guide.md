# AWS Rekognition Setup Guide

Complete guide to configure AWS Rekognition for biometric face matching.

---

## 📋 Prerequisites

- AWS Account (free tier available)
- Credit card (required for AWS signup)
- Access to AWS Console

---

## 🚀 Step-by-Step Setup

### Step 1: Create AWS Account

1. Visit: https://aws.amazon.com/
2. Click **"Create an AWS Account"**
3. Fill in:
   - Email address
   - Password
   - AWS account name
4. Complete signup (requires credit card verification)

**Note:** AWS Rekognition has a free tier:
- 1,000 face comparisons per month (first 12 months)
- After free tier: ~$0.001 per comparison

---

### Step 2: Create IAM User with Rekognition Access

1. **Login to AWS Console:** https://console.aws.amazon.com/

2. **Navigate to IAM:**
   - Search "IAM" in the top search bar
   - Click "Identity and Access Management"

3. **Create User:**
   - Click **"Users"** in left sidebar
   - Click **"Create user"** button
   - Enter username: `klassic-attendance-rekognition`
   - Click **"Next"**

4. **Set Permissions:**
   - Select **"Attach policies directly"**
   - In search box, type: `Rekognition`
   - Check the box for: **`AmazonRekognitionFullAccess`**
   - Click **"Next"** → **"Create user"**

5. **Create Access Key:**
   - Click on the newly created user
   - Go to **"Security credentials"** tab
   - Scroll to **"Access keys"** section
   - Click **"Create access key"**
   - Select **"Application running outside AWS"**
   - Click **"Next"** → **"Create access key"**

6. **Save Your Credentials:**
   - **Access key ID** - Looks like: `AKIAIOSFODNN7EXAMPLE`
   - **Secret access key** - Long string, only shown once!
   - Click **"Download .csv file"** (⚠️ IMPORTANT - save this!)
   - Store securely (treat like a password)

---

### Step 3: Configure Backend Environment

1. **Open:** `backend/.env`

2. **Update these lines:**
   ```env
   AWS_REGION=ap-southeast-1
   AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
   AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   FACE_MATCH_THRESHOLD=0.85
   LIVENESS_THRESHOLD=0.7
   ```

3. **Replace with your actual credentials:**
   - Paste your **Access Key ID**
   - Paste your **Secret Access Key**
   - Keep no extra spaces before/after values

---

### Step 4: Test Configuration

1. **Install dependencies (if not already):**
   ```powershell
   cd backend
   npm install
   ```

2. **Run test script:**
   ```powershell
   npx ts-node test-aws-rekognition.ts
   ```

3. **Expected output:**
   ```
   🔍 Testing AWS Rekognition Configuration...
   
   ✓ AWS credentials found in .env
   ✓ Region: ap-southeast-1
   
   📡 Attempting to connect to AWS Rekognition...
   
   ✅ SUCCESS! AWS Rekognition is configured correctly!
   
   Your biometric features are ready to use:
     ✓ Face enrollment
     ✓ Face verification
     ✓ Liveness detection
     ✓ Quality assessment
   
   🚀 You can now start using biometric attendance tracking!
   ```

---

## 🔧 Configuration Options

### Region Selection

Choose the AWS region closest to your location:

| Region | Code | Location |
|--------|------|----------|
| Asia Pacific (Singapore) | `ap-southeast-1` | 🇸🇬 Recommended for Philippines |
| Asia Pacific (Tokyo) | `ap-northeast-1` | 🇯🇵 Japan |
| Asia Pacific (Sydney) | `ap-southeast-2` | 🇦🇺 Australia |
| US East (N. Virginia) | `us-east-1` | 🇺🇸 USA |
| EU (Ireland) | `eu-west-1` | 🇮🇪 Europe |

### Confidence Thresholds

```env
# Face match threshold (0-1)
# 0.85 = 85% similarity required (recommended)
# Higher = more strict, Lower = more lenient
FACE_MATCH_THRESHOLD=0.85

# Liveness threshold (0-1)
# 0.7 = 70% confidence eyes are open (recommended)
LIVENESS_THRESHOLD=0.7
```

**Recommendations:**
- **High security:** `FACE_MATCH_THRESHOLD=0.90`
- **Balanced:** `FACE_MATCH_THRESHOLD=0.85` ⭐
- **Lenient:** `FACE_MATCH_THRESHOLD=0.75`

---

## 🐛 Troubleshooting

### Error: "Invalid AWS credentials"

**Problem:** Wrong access key or secret key

**Solution:**
1. Go to IAM → Users → Your user
2. Security credentials → Access keys
3. Verify the Access Key ID matches your `.env`
4. If wrong, create a new access key
5. Update `.env` with new credentials

### Error: "Access denied"

**Problem:** IAM user lacks permissions

**Solution:**
1. Go to IAM → Users → Your user
2. Permissions tab
3. Add policy: `AmazonRekognitionFullAccess`
4. Save and test again

### Error: "Region not supported"

**Problem:** Rekognition not available in your region

**Solution:**
- Change `AWS_REGION` to `ap-southeast-1` or `us-east-1`
- These regions always support Rekognition

### Test script fails to run

**Problem:** Missing dependencies

**Solution:**
```powershell
cd backend
npm install @aws-sdk/client-rekognition
npm install -D ts-node
```

---

## 💰 Cost Estimation

### AWS Rekognition Pricing (as of 2024)

**Free Tier (First 12 months):**
- 1,000 face comparisons per month - FREE

**After Free Tier:**
- Face comparison: $0.001 per image
- Face detection: $0.001 per image

**Example Monthly Costs:**
- 50 employees × 2 check-ins/day × 22 days = 2,200 comparisons
- Cost: 2,200 × $0.001 = **$2.20/month**
- First 1,000 free = **$1.20/month** actual cost

**Cost Saving Tips:**
1. Use self-hosted InsightFace for high-volume usage
2. Cache verification results for short periods
3. Only verify on check-in/out (not continuous)

---

## 🔒 Security Best Practices

### 1. Protect Your Credentials

⚠️ **NEVER commit `.env` to Git**

Check your `.gitignore` includes:
```
.env
.env.local
.env.*.local
```

### 2. Rotate Access Keys Regularly

- Create new access key every 90 days
- Delete old access key after updating `.env`

### 3. Use IAM Best Practices

- ✅ Create dedicated IAM user (don't use root account)
- ✅ Only grant Rekognition permissions (principle of least privilege)
- ✅ Enable MFA on root account
- ✅ Monitor usage in AWS CloudWatch

### 4. Encryption at Rest

For production, encrypt stored face embeddings:
```typescript
// In biometric.service.ts (future enhancement)
import { createCipheriv, createDecipheriv } from 'crypto';

const encryptionKey = process.env.ENCRYPTION_KEY; // 32 bytes
// Encrypt before saving to database
// Decrypt before sending to Rekognition
```

---

## 📊 Monitoring Usage

### View Usage in AWS Console

1. Go to AWS Console → Rekognition
2. Click "Usage" or "Monitoring"
3. View:
   - API calls per day
   - Cost per service
   - Error rates

### Set Up Billing Alerts

1. Go to AWS Console → Billing
2. Click "Budgets"
3. Create budget:
   - Name: "Rekognition Monthly Limit"
   - Amount: $5.00
   - Alert threshold: 80%

---

## 🔄 Alternative: Self-Hosted Option

If you prefer not to use AWS (cost or data privacy):

1. **Use InsightFace (open-source):**
   ```env
   # Disable AWS
   AWS_ACCESS_KEY_ID=
   AWS_SECRET_ACCESS_KEY=
   
   # Enable self-hosted
   FACE_MATCH_SERVICE_URL=http://localhost:8000
   FACE_MATCH_API_KEY=your-secret-key
   ```

2. **Deploy InsightFace service:**
   - Requires GPU for good performance
   - Docker image available
   - Free for on-premise use

---

## ✅ Verification Checklist

- [ ] AWS account created
- [ ] IAM user created with Rekognition permissions
- [ ] Access keys generated and saved
- [ ] `.env` file updated with credentials
- [ ] Test script passes successfully
- [ ] Backend starts without errors
- [ ] Swagger docs show biometric endpoints
- [ ] Ready to test face enrollment!

---

**Need Help?**
- AWS Support: https://console.aws.amazon.com/support/
- AWS Rekognition Docs: https://docs.aws.amazon.com/rekognition/

**Next Step:** Test face enrollment using Swagger UI at http://localhost:3000/api-docs
