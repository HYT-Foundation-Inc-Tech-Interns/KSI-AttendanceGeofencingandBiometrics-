# 🔐 Login Instructions - UPDATED

## ✅ Changes Made (Just Now)

1. **Fixed API response handling** - Backend returns `access_token`/`refresh_token`, frontend now handles both formats
2. **Fixed email placeholder** - Changed from `hr@klassic.ph` to `admin@klassic.ph`
3. **Disabled autofill** - Added `autoComplete="off"` to prevent browser interference
4. **Fixed CORS** - Backend now allows connections from `172.16.0.2:3001` (your network IP)

---

## 🚀 How to Login NOW

### Step 1: Refresh Your Browser
Close the current tab and open a fresh one: **http://localhost:3001**

### Step 2: Clear the Form
- Click in the email field
- Delete any autofilled text
- Type fresh: `admin@klassic.ph`

### Step 3: Enter Password
- Click in password field
- Type: `admin123`

### Step 4: Click "Sign In"

It should work now! 🎉

---

## 🔧 If Still Having Issues

### Issue 1: "Failed to fetch"
**Cause**: Backend not running or CORS issue

**Fix**:
```powershell
# Check backend is running
curl http://localhost:3000/v1/health

# If not running, restart:
cd backend
npm run start:dev
```

### Issue 2: Autofill Interference
**Cause**: Browser remembering old credentials

**Fix**:
1. Use Incognito/Private window
2. Or manually clear both fields completely
3. Or use: http://127.0.0.1:3001 instead

### Issue 3: Network IP Issues
**Cause**: Accessing via `172.16.0.2:3001` instead of `localhost`

**Fix**: Use `http://localhost:3001` instead

---

## ✅ Correct Credentials

**DO NOT USE:**
- ❌ `hr@klassic.ph` / `hr123`

**USE THESE:**
- ✅ Email: `admin@klassic.ph`
- ✅ Password: `admin123`

---

## 🎯 After Successful Login

You'll be redirected to: `http://localhost:3001/dashboard`

You should see:
- Sidebar with navigation (Dashboard, Attendance, Employees, Sites, Reports)
- Stats cards (Employees, Sites, Check-ins, Flagged events)
- Recent activity feed
- Your profile in the bottom-left corner

---

## 🐛 Debugging

### Check if backend login works directly:
```powershell
$body = @{email='admin@klassic.ph';password='admin123'} | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:3000/v1/auth/login' -Method POST -Body $body -ContentType 'application/json'
```

Should return:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": {
    "id": "...",
    "email": "admin@klassic.ph",
    "full_name": "Admin User",
    "role": "admin"
  }
}
```

### Check browser console (F12):
- Look for any error messages
- Check Network tab for failed requests
- Should see successful POST to `/v1/auth/login`

---

## 📞 Quick Reference

**Backend**: http://localhost:3000
**Dashboard**: http://localhost:3001
**API Docs**: http://localhost:3000/api-docs

**Admin Credentials**:
- Email: `admin@klassic.ph`
- Password: `admin123`

---

**Last Updated**: September 14, 2026 1:20 PM  
**Status**: ✅ CORS Fixed, API Response Fixed, Ready to Login
