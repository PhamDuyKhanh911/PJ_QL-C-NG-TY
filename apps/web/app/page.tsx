const stats = [
  { label: 'Doanh thu hôm nay', value: '128,4 triệu', note: '+12,8% so với hôm qua', tone: 'green' },
  { label: 'Đơn đang xử lý', value: '286', note: '34 đơn cần xác nhận', tone: 'blue' },
  { label: 'Chat chưa trả lời', value: '18', note: '5 hội thoại sắp quá SLA', tone: 'orange' },
  { label: 'SKU sắp hết', value: '27', note: '8 SKU có thể hết trong 3 ngày', tone: 'red' },
];

const channels = [
  ['TikTok Seller 01', 'TikTok Shop', '1.248', '3,2%', 'Ổn định'],
  ['TikTok Seller 02', 'TikTok Shop', '986', '4,1%', 'Ổn định'],
  ['TikTok Seller 03', 'TikTok Shop', '741', '5,8%', 'Cần theo dõi'],
  ['Shopee Seller 01', 'Shopee', '1.536', '2,7%', 'Ổn định'],
  ['Shopee Seller 02', 'Shopee', '822', '3,5%', 'Ổn định'],
  ['Shopee Seller 03', 'Shopee', '639', '6,2%', 'Cần theo dõi'],
];

export default function Dashboard() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>Q</span><div>QUẢN TRỊ<small>Doanh nghiệp đa kênh</small></div></div>
        <nav>
          <a className="active">Tổng quan</a>
          <a>Đơn hàng</a><a>Bán hàng POS</a><a>Sản phẩm</a><a>Kho hàng</a>
          <a>Kênh bán hàng</a><a>Hộp thư chung <b>18</b></a><a>Khách hàng</a>
          <a>Mua hàng</a><a>Báo cáo</a><a>Nhân viên & phân quyền</a><a>Cấu hình</a>
        </nav>
        <div className="user"><i>NA</i><div>Nguyễn An<small>Quản trị viên</small></div></div>
      </aside>

      <main>
        <header><div><h1>Trung tâm điều hành</h1><p>Thứ tư, 18 tháng 11 năm 2026</p></div><button>+ Tạo đơn hàng</button></header>
        <section className="filters"><button>Hôm nay⌄</button><button>Tất cả kênh⌄</button><button>Tất cả chi nhánh⌄</button><span>Dữ liệu cập nhật 17:42</span></section>
        <section className="stats">{stats.map((item) => <article key={item.label}><div className={`dot ${item.tone}`}></div><p>{item.label}</p><h2>{item.value}</h2><small>{item.note}</small></article>)}</section>
        <section className="grid">
          <article className="panel performance"><div className="panel-title"><div><h3>Hiệu quả kinh doanh</h3><p>Doanh thu online và offline trong 7 ngày</p></div><strong>782,6 triệu</strong></div><div className="chart"><div className="axis"><span>150tr</span><span>100tr</span><span>50tr</span><span>0</span></div>{[62,78,55,92,68,83,96].map((h,i)=><div className="bar-wrap" key={i}><div className="bar" style={{height:`${h}%`}}></div><span>{12+i}/11</span></div>)}</div></article>
          <article className="panel alerts"><div className="panel-title"><div><h3>Cảnh báo cần xử lý</h3><p>Ưu tiên theo mức độ ảnh hưởng</p></div><a>Xem tất cả</a></div>
            <div className="alert critical"><b>8 SKU có nguy cơ hết hàng</b><span>Trong vòng 3 ngày tới</span></div>
            <div className="alert warning"><b>5 hội thoại sắp quá SLA</b><span>Cần phản hồi trong 15 phút</span></div>
            <div className="alert info"><b>3 tác vụ đồng bộ thất bại</b><span>Shopee Seller 03</span></div>
          </article>
        </section>
        <article className="panel channel-table"><div className="panel-title"><div><h3>Hiệu suất theo gian hàng</h3><p>30 ngày gần nhất</p></div><a>Xuất báo cáo</a></div><table><thead><tr><th>Gian hàng</th><th>Kênh</th><th>Đơn hàng</th><th>Tỷ lệ hủy/hoàn</th><th>Trạng thái</th></tr></thead><tbody>{channels.map((c)=><tr key={c[0]}><td><strong>{c[0]}</strong></td><td>{c[1]}</td><td>{c[2]}</td><td>{c[3]}</td><td><span className={c[4]==='Ổn định'?'status ok':'status watch'}>{c[4]}</span></td></tr>)}</tbody></table></article>
      </main>
    </div>
  );
}

