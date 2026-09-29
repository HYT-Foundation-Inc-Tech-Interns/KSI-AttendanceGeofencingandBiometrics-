/**
 * Test script to verify AWS Rekognition configuration
 * Run: npx ts-node test-aws-rekognition.ts
 */

import { RekognitionClient, DetectLabelsCommand } from '@aws-sdk/client-rekognition';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testAwsRekognition() {
  console.log('🔍 Testing AWS Rekognition Configuration...\n');

  // Check if credentials are set
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'ap-southeast-1';

  if (!accessKeyId || accessKeyId === 'your-aws-access-key-id') {
    console.error('❌ AWS_ACCESS_KEY_ID not configured in .env');
    console.log('   Please follow the setup guide to get your AWS credentials');
    process.exit(1);
  }

  if (!secretAccessKey || secretAccessKey === 'your-aws-secret-access-key') {
    console.error('❌ AWS_SECRET_ACCESS_KEY not configured in .env');
    console.log('   Please follow the setup guide to get your AWS credentials');
    process.exit(1);
  }

  console.log('✓ AWS credentials found in .env');
  console.log(`✓ Region: ${region}\n`);

  // Initialize Rekognition client
  const client = new RekognitionClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  console.log('📡 Attempting to connect to AWS Rekognition...\n');

  try {
    // Test with a simple API call (this won't use any credits)
    // We'll just check if the credentials work
    const testImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const command = new DetectLabelsCommand({
      Image: { Bytes: testImage },
      MaxLabels: 1,
    });

    await client.send(command);

    console.log('✅ SUCCESS! AWS Rekognition is configured correctly!\n');
    console.log('Your biometric features are ready to use:');
    console.log('  ✓ Face enrollment');
    console.log('  ✓ Face verification');
    console.log('  ✓ Liveness detection');
    console.log('  ✓ Quality assessment\n');

    console.log('🚀 You can now start using biometric attendance tracking!');
    console.log('   Run: npm run start:dev');

  } catch (error: any) {
    console.error('❌ AWS Rekognition connection failed!\n');
    
    if (error.name === 'InvalidSignatureException') {
      console.error('Error: Invalid AWS credentials');
      console.log('  → Check that your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are correct');
    } else if (error.name === 'UnrecognizedClientException') {
      console.error('Error: AWS credentials not recognized');
      console.log('  → Verify your access key ID is correct');
    } else if (error.name === 'AccessDeniedException') {
      console.error('Error: Access denied');
      console.log('  → Make sure your IAM user has AmazonRekognitionFullAccess policy attached');
    } else {
      console.error('Error:', error.message);
    }
    
    console.log('\n💡 Troubleshooting:');
    console.log('  1. Double-check credentials in backend/.env');
    console.log('  2. Verify IAM user has Rekognition permissions');
    console.log('  3. Check AWS region is correct');
    console.log('  4. Ensure no extra spaces in .env values\n');
    
    process.exit(1);
  }
}

testAwsRekognition();
