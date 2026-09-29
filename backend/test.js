
const http = require("http");
const req = http.request("http://localhost:3000/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" }
}, (res) => {
  let body = "";
  res.on("data", chunk => body += chunk);
  res.on("end", () => {
    const data = JSON.parse(body);
    if (data.access_token) {
        const empReq = http.request("http://localhost:3000/v1/employees", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": "Bearer " + data.access_token
            }
        }, (res2) => {
            let body2 = "";
            res2.on("data", chunk => body2 += chunk);
            res2.on("end", () => { console.log("Create result:", body2); });
        });
        const d = {employeeCode:"EMP003",fullName:"Ryan Domer",email:"ryandomer566@gmail.com",phone:"",siteId:"7c76cc78-4389-40ed-8468-f9b699a9b23b",status:"active",hiredAt:"2026-09-16"};
        empReq.write(JSON.stringify(d));
        empReq.end();
    } else {
        console.log("Login failed", body);
    }
  });
});
req.write(JSON.stringify({ email: "admin@klassic.ph", password: "password123" }));
req.end();

