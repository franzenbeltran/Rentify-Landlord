# Firebase Setup Guide for Rentify

## Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select an existing project
3. Follow the setup wizard (you can disable Google Analytics if you want)

## Step 2: Enable Authentication

1. In your Firebase project, go to **Authentication** in the left sidebar
2. Click **Get Started**
3. Click on **Sign-in method** tab
4. Enable **Email/Password** authentication
5. Click **Save**

## Step 3: Create Firestore Database

1. Go to **Firestore Database** in the left sidebar
2. Click **Create database**
3. Choose **Start in test mode** (for development)
4. Select a location for your database (choose the closest to your users)
5. Click **Enable**

## Step 4: Get Your Firebase Configuration

1. In Firebase Console, click the gear icon ⚙️ next to "Project Overview"
2. Select **Project settings**
3. Scroll down to **Your apps** section
4. Click the **</>** (Web) icon to add a web app
5. Register your app (you can name it "Rentify")
6. Copy the `firebaseConfig` object that appears

## Step 5: Update Your Configuration

1. Open `auth.js` in your project
2. Find the `firebaseConfig` object at the top of the file
3. Replace the placeholder values with your actual Firebase config:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

## Step 6: Set Up Firestore Security Rules (Important!)

1. Go to **Firestore Database** > **Rules** tab
2. Replace the default rules with these:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Landlords collection - users can only read/write their own data
    match /landlords/{landlordId} {
      allow read, write: if request.auth != null && request.auth.uid == landlordId;
    }
    
    // Tenants collection - users can only read/write tenants for their landlordId
    match /tenants/{tenantId} {
      allow read, write: if request.auth != null && 
        resource.data.landlordId == request.auth.uid;
      allow create: if request.auth != null && 
        request.resource.data.landlordId == request.auth.uid;
    }
  }
}
```

3. Click **Publish**

## Step 7: Test Your Setup

1. Open `login.html` in your browser
2. Try creating a new account via `signup.html`
3. After signup, you should be redirected to the dashboard
4. Try adding a tenant - it should save to Firestore

## Troubleshooting

### "Failed to fetch" error
- Make sure you've updated the `firebaseConfig` in `auth.js` with your actual Firebase credentials
- Check the browser console for specific error messages
- Verify that Email/Password authentication is enabled in Firebase Console

### Data not saving
- Check Firestore security rules - make sure they allow authenticated users to write
- Check browser console for any Firestore errors
- Verify you're logged in (check localStorage for `landlordToken`)

### Can't see data in Firestore
- Go to Firestore Database in Firebase Console
- You should see two collections: `landlords` and `tenants`
- Make sure you're viewing the correct Firebase project

## Collections Structure

### `landlords` collection
- Document ID: User's Firebase Auth UID
- Fields: `name`, `email`, `createdAt`

### `tenants` collection
- Document ID: Auto-generated
- Fields: `name`, `room`, `rent`, `dueDate`, `status`, `landlordId`, `createdAt`, `updatedAt`

## That's it!

Your Rentify app is now using Firebase for authentication and data storage. No backend server needed!

